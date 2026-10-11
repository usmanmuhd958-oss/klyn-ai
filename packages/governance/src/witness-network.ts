import { createRequire } from 'node:module';
import { createServer, request as httpsRequest, type Server as HttpsServer } from 'node:https';
import { createHash, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { URL } from 'node:url';
import {
  KEL_TREE_HEAD_PAYLOAD_TYPE,
  canonicalizeJcs,
  digestJcs,
  verifyDsseEnvelope,
  type DsseEnvelopeV1,
  type TreeHeadV1,
} from './kel.js';
import { WitnessQuorumVerifier, type WitnessSignatureV1 } from './witness.js';

const NETWORK_SCHEMA = 'urn:klyn:witness-network-message:v1';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_PEERS = 16;

export interface IndependentWitnessSigner {
  readonly witnessId: string;
  readonly keyId: string;
  readonly keyEpoch: string;
  readonly publicKey: KeyObject;
  /** Private operation must be performed by a separate HSM/KMS adapter. */
  signCanonicalStatement(message: Uint8Array): Promise<Uint8Array>;
}
export interface WitnessPeer {
  readonly url: string;
  readonly authToken: string;
  readonly timeoutMs?: number;
}
export interface DurableWitnessReceiptStore {
  put(checkpointDigest: string, signature: WitnessSignatureV1, receivedAtEpochMs: string): void;
  list(checkpointDigest: string): readonly WitnessSignatureV1[];
}
export interface WitnessNetworkWorkerOptions {
  readonly bindHost: string;
  readonly port: number;
  /** HTTPS listener. Mutual TLS is enabled and client certificates are required. */
  readonly tls: { readonly key: string | Buffer; readonly cert: string | Buffer; readonly ca: string | Buffer };
  readonly authToken: string;
  readonly signer: IndependentWitnessSigner;
  readonly trustedCheckpointKeys: ReadonlyMap<string, KeyObject>;
  readonly quorumVerifier: WitnessQuorumVerifier;
  readonly receiptStore: DurableWitnessReceiptStore;
  readonly peers?: readonly WitnessPeer[];
  readonly maxConcurrentRequests?: number;
}
interface WorkerMessageV1 {
  readonly schema: typeof NETWORK_SCHEMA;
  readonly checkpointEnvelope: DsseEnvelopeV1;
  readonly signatures: readonly WitnessSignatureV1[];
}
interface WorkerResponseV1 {
  readonly schema: typeof NETWORK_SCHEMA;
  readonly witnessId: string;
  readonly checkpointDigest: string;
  readonly signatures: readonly WitnessSignatureV1[];
  readonly validWitnessIds: readonly string[];
  readonly accepted: boolean;
  readonly reasonCodes: readonly string[];
}
interface SqliteReceiptRow {
  witness_id: string;
  key_id: string;
  key_epoch: string;
  signature_base64: string;
}

function safeEqualText(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh) && a.length === b.length;
}
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  response.end(bytes);
}
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RangeError('witness message exceeds body size limit'));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once('error', reject);
    request.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { reject(new TypeError('witness message is not valid JSON')); }
    });
  });
}
function parseMessage(input: unknown): WorkerMessageV1 {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('witness message must be an object');
  const row = input as Record<string, unknown>;
  if (row.schema !== NETWORK_SCHEMA || typeof row.checkpointEnvelope !== 'object' ||
      row.checkpointEnvelope === null || !Array.isArray(row.signatures) || row.signatures.length > 3) {
    throw new TypeError('witness network schema is invalid');
  }
  const allowed = new Set(['schema', 'checkpointEnvelope', 'signatures']);
  if (Object.keys(row).some((key) => !allowed.has(key))) throw new TypeError('unknown witness message field');
  return row as unknown as WorkerMessageV1;
}

/** Durable SQLite receipt store, independently owned by each witness service. */
export class SqliteWitnessReceiptStore implements DurableWitnessReceiptStore {
  private readonly database: DatabaseSyncType;

  public constructor(path: string) {
    if (!path.trim()) throw new TypeError('witness receipt database path is required');
    const require = createRequire(import.meta.url);
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
    try {
      DatabaseSync = (require('node:sqlite') as { DatabaseSync: typeof import('node:sqlite').DatabaseSync }).DatabaseSync;
    } catch (error) {
      throw new Error('witness receipt persistence requires Node with node:sqlite support', { cause: error });
    }
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS witness_worker_receipts (" +
      "checkpoint_digest TEXT NOT NULL, witness_id TEXT NOT NULL, key_id TEXT NOT NULL, " +
      "key_epoch TEXT NOT NULL, signature_base64 TEXT NOT NULL, received_at_epoch_ms TEXT NOT NULL, " +
      "PRIMARY KEY(checkpoint_digest, witness_id)) STRICT;" +
      "CREATE TRIGGER IF NOT EXISTS witness_worker_receipts_no_update BEFORE UPDATE ON witness_worker_receipts " +
      "BEGIN SELECT RAISE(ABORT, 'witness worker receipts are append-only'); END;" +
      "CREATE TRIGGER IF NOT EXISTS witness_worker_receipts_no_delete BEFORE DELETE ON witness_worker_receipts " +
      "BEGIN SELECT RAISE(ABORT, 'witness worker receipts are append-only'); END;"
    );
  }

  public put(checkpointDigest: string, signature: WitnessSignatureV1, receivedAtEpochMs: string): void {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const previous = this.database.prepare(
        'SELECT key_id, key_epoch, signature_base64 FROM witness_worker_receipts WHERE checkpoint_digest=? AND witness_id=?',
      ).get(checkpointDigest, signature.witnessId) as {
        key_id?: string; key_epoch?: string; signature_base64?: string;
      } | undefined;
      if (previous) {
        if (previous.key_id !== signature.keyId || previous.key_epoch !== signature.keyEpoch ||
            previous.signature_base64 !== signature.signatureBase64) {
          throw new Error('conflicting receipt for the same witness/checkpoint');
        }
      } else {
        this.database.prepare(
          'INSERT INTO witness_worker_receipts(checkpoint_digest,witness_id,key_id,key_epoch,signature_base64,received_at_epoch_ms) VALUES(?,?,?,?,?,?)',
        ).run(checkpointDigest, signature.witnessId, signature.keyId, signature.keyEpoch, signature.signatureBase64, receivedAtEpochMs);
      }
      this.database.exec('COMMIT;');
    } catch (error) {
      try { this.database.exec('ROLLBACK;'); } catch { /* preserve original */ }
      throw error;
    }
  }

  public list(checkpointDigest: string): readonly WitnessSignatureV1[] {
    const rows = this.database.prepare(
      'SELECT witness_id,key_id,key_epoch,signature_base64 FROM witness_worker_receipts WHERE checkpoint_digest=? ORDER BY witness_id',
    ).all(checkpointDigest) as unknown as SqliteReceiptRow[];
    return rows.map((row) => ({
      witnessId: row.witness_id,
      keyId: row.key_id,
      keyEpoch: row.key_epoch,
      signatureBase64: row.signature_base64,
    }));
  }

  public close(): void {
    if (this.database.isOpen) this.database.close();
  }
}

/**
 * One independent witness node. Requires TLS client certificates plus token authentication.
 * Each node signs only with its own HSM/KMS provider and validates gossip itself.
 */
export class WitnessNetworkWorker {
  private server: HttpsServer | undefined;
  private readonly peers: readonly WitnessPeer[];
  private readonly maxConcurrentRequests: number;
  private activeRequests = 0;

  public constructor(private readonly options: WitnessNetworkWorkerOptions) {
    if (!options.bindHost || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
      throw new TypeError('witness bindHost and port are required');
    }
    if (!options.authToken || options.authToken.length < 32) throw new TypeError('witness API token must be at least 32 characters');
    this.peers = options.peers ?? [];
    this.maxConcurrentRequests = options.maxConcurrentRequests ?? 16;
    if (!Number.isSafeInteger(this.maxConcurrentRequests) || this.maxConcurrentRequests < 1 || this.maxConcurrentRequests > 128) {
      throw new RangeError('maxConcurrentRequests must be in 1..128');
    }
    if (this.peers.length > MAX_PEERS) throw new RangeError('witness peer list exceeds maximum');
    for (const peer of this.peers) {
      const parsed = new URL(peer.url);
      if (parsed.protocol !== 'https:' || !peer.authToken || parsed.username || parsed.password) {
        throw new TypeError('witness peers must be credential-free HTTPS URLs with a separate token');
      }
    }
    if (options.signer.publicKey.type !== 'public' || options.signer.publicKey.asymmetricKeyType !== 'ed25519') {
      throw new TypeError('witness signer must expose an Ed25519 public KeyObject');
    }
  }

  public async listen(): Promise<void> {
    if (this.server) throw new Error('witness worker already listening');
    const server = createServer({
      key: this.options.tls.key,
      cert: this.options.tls.cert,
      ca: this.options.tls.ca,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      maxConnections: this.maxConcurrentRequests,
    }, (request, response) => {
      if (this.activeRequests >= this.maxConcurrentRequests) {
        sendJson(response, 503, { error: 'capacity_exhausted' });
        return;
      }
      this.activeRequests += 1;
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
        else response.destroy();
      }).finally(() => {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.bindHost, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    this.server = undefined;
  }

  private authorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return false;
    return safeEqualText(this.options.authToken, authorization.slice(7));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/healthz') {
      sendJson(response, 200, { ok: true, witnessId: this.options.signer.witnessId });
      return;
    }
    if (!this.authorized(request)) {
      sendJson(response, 401, { error: 'unauthenticated' });
      return;
    }
    if (request.method !== 'POST' ||
        (request.url !== '/v1/witness/attest' && request.url !== '/v1/witness/gossip')) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      sendJson(response, 415, { error: 'content_type_required' });
      return;
    }

    let message: WorkerMessageV1;
    try { message = parseMessage(await readJson(request)); }
    catch (error) {
      sendJson(response, error instanceof RangeError ? 413 : 400, { error: 'invalid_message' });
      return;
    }
    const head = this.verifyCheckpoint(message.checkpointEnvelope);
    if (!head) {
      sendJson(response, 422, { error: 'checkpoint_rejected' });
      return;
    }
    const checkpointDigest = digestJcs(message.checkpointEnvelope);
    const now = String(Date.now());
    const incomingQuorum = this.options.quorumVerifier.verify(message.checkpointEnvelope, message.signatures, now);
    const validInput = message.signatures.filter((item) => incomingQuorum.validWitnessIds.includes(item.witnessId));
    for (const signature of validInput) this.options.receiptStore.put(checkpointDigest, signature, now);

    let own = this.options.receiptStore.list(checkpointDigest).find((item) => item.witnessId === this.options.signer.witnessId);
    if (!own) {
      own = await this.signCheckpoint(head, message.checkpointEnvelope);
      this.options.receiptStore.put(checkpointDigest, own, now);
    }

    const aggregate = new Map<string, WitnessSignatureV1>();
    for (const signature of [...this.options.receiptStore.list(checkpointDigest), own, ...validInput]) {
      const previous = aggregate.get(signature.witnessId);
      if (previous && (previous.signatureBase64 !== signature.signatureBase64 || previous.keyId !== signature.keyId)) {
        throw new Error('gossip contains conflicting signature for the same witness');
      }
      aggregate.set(signature.witnessId, signature);
    }

    if (request.url === '/v1/witness/attest') {
      // Sequential gossip carries the enlarged receipt set to each next independent node.
      for (const peer of this.peers) {
        try {
          const peerReply = await this.postPeer(peer, '/v1/witness/gossip', {
            schema: NETWORK_SCHEMA,
            checkpointEnvelope: message.checkpointEnvelope,
            signatures: [...aggregate.values()],
          });
          for (const signature of peerReply.signatures) {
            const previous = aggregate.get(signature.witnessId);
            if (previous && (previous.signatureBase64 !== signature.signatureBase64 || previous.keyId !== signature.keyId)) {
              continue;
            }
            aggregate.set(signature.witnessId, signature);
          }
        } catch {
          // Unavailable peers do not count toward quorum; other peers are still attempted.
        }
      }
    }

    const finalSignatures = [...aggregate.values()];
    const quorum = this.options.quorumVerifier.verify(message.checkpointEnvelope, finalSignatures, now);
    for (const signature of finalSignatures) {
      if (quorum.validWitnessIds.includes(signature.witnessId)) this.options.receiptStore.put(checkpointDigest, signature, now);
    }
    const reply: WorkerResponseV1 = {
      schema: NETWORK_SCHEMA,
      witnessId: this.options.signer.witnessId,
      checkpointDigest,
      signatures: finalSignatures,
      validWitnessIds: quorum.validWitnessIds,
      accepted: quorum.accepted,
      reasonCodes: quorum.reasonCodes,
    };
    sendJson(response, 200, reply);
  }

  private verifyCheckpoint(envelope: DsseEnvelopeV1): TreeHeadV1 | undefined {
    try {
      const value = verifyDsseEnvelope(envelope, KEL_TREE_HEAD_PAYLOAD_TYPE, this.options.trustedCheckpointKeys);
      const head = value as unknown as TreeHeadV1;
      if (head.schema !== 'urn:klyn:tree-head:v1' ||
          !/^(0|[1-9][0-9]*)$/.test(head.treeSize) ||
          !/^(0|[1-9][0-9]*)$/.test(head.keyEpoch) ||
          !/^(0|[1-9][0-9]*)$/.test(head.issuedAtEpochMs)) return undefined;
      return head;
    } catch {
      return undefined;
    }
  }

  private async signCheckpoint(head: TreeHeadV1, envelope: DsseEnvelopeV1): Promise<WitnessSignatureV1> {
    const statement = {
      schema: 'urn:klyn:witness-statement:v1',
      witnessId: this.options.signer.witnessId,
      ledgerId: head.ledgerId,
      treeSize: head.treeSize,
      rootHash: head.rootHash,
      treeHeadDigest: digestJcs(envelope),
      checkpointKeyEpoch: head.keyEpoch,
      issuedAtEpochMs: head.issuedAtEpochMs,
    };
    const bytes = Buffer.from(canonicalizeJcs(statement), 'utf8');
    const signature = Buffer.from(await this.options.signer.signCanonicalStatement(bytes));
    if (signature.length !== 64 || !verify(null, bytes, this.options.signer.publicKey, signature)) {
      throw new Error('witness signer produced an invalid signature');
    }
    return {
      witnessId: this.options.signer.witnessId,
      keyId: this.options.signer.keyId,
      keyEpoch: this.options.signer.keyEpoch,
      signatureBase64: signature.toString('base64'),
    };
  }

  private async postPeer(peer: WitnessPeer, path: string, payload: WorkerMessageV1): Promise<WorkerResponseV1> {
    const url = new URL(path, peer.url);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    if (body.length > MAX_BODY_BYTES) throw new RangeError('gossip body exceeds configured size limit');
    return await new Promise<WorkerResponseV1>((resolve, reject) => {
      const request = httpsRequest(url, {
        method: 'POST',
        key: this.options.tls.key,
        cert: this.options.tls.cert,
        ca: this.options.tls.ca,
        rejectUnauthorized: true,
        timeout: peer.timeoutMs ?? 2_000,
        headers: {
          authorization: 'Bearer ' + peer.authToken,
          'content-type': 'application/json',
          accept: 'application/json',
          'content-length': String(body.length),
        },
      }, (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new RangeError('witness peer response exceeded body limit'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.once('error', reject);
        response.once('end', () => {
          if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
            reject(new Error('witness peer returned HTTP ' + response.statusCode));
            return;
          }
          let value: unknown;
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
          catch { reject(new Error('witness peer response is not valid JSON')); return; }
          if (typeof value !== 'object' || value === null ||
              (value as Record<string, unknown>).schema !== NETWORK_SCHEMA ||
              !Array.isArray((value as Record<string, unknown>).signatures)) {
            reject(new Error('witness peer response schema is invalid'));
            return;
          }
          resolve(value as unknown as WorkerResponseV1);
        });
      });
      request.once('timeout', () => request.destroy(new Error('witness peer request timed out')));
      request.once('error', reject);
      request.end(body);
    });
  }
}
