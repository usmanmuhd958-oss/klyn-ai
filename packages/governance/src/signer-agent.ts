import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { canonicalizeJcs, KEL_TREE_HEAD_PAYLOAD_TYPE, KEL_TREE_HEAD_SCHEMA } from './kel.js';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 64 * 1024;

export interface Ed25519HsmKmsDriver {
  readonly keyId: string;
  readonly keyEpoch: string;
  /** Raw 32-byte Ed25519 public key. Public material only. */
  readonly publicKeyRaw: Uint8Array;
  /** Ask the HSM/PKCS#11 module or KMS API to sign the bytes without exporting its private key. */
  signEd25519(message: Uint8Array): Promise<Uint8Array>;
}

/** Adapt a PKCS#11 session; the injected driver retains all private key custody. */
export class Pkcs11Ed25519Driver implements Ed25519HsmKmsDriver {
  public constructor(
    public readonly keyId: string,
    public readonly keyEpoch: string,
    public readonly publicKeyRaw: Uint8Array,
    private readonly signWithHsm: (message: Uint8Array) => Promise<Uint8Array>,
  ) {}
  public async signEd25519(message: Uint8Array): Promise<Uint8Array> {
    return await this.signWithHsm(message);
  }
}

/** Adapt an authenticated cloud KMS client's Ed25519/raw-message signing operation. */
export class CloudKmsEd25519Driver implements Ed25519HsmKmsDriver {
  public constructor(
    public readonly keyId: string,
    public readonly keyEpoch: string,
    public readonly publicKeyRaw: Uint8Array,
    private readonly signWithKms: (keyId: string, message: Uint8Array) => Promise<Uint8Array>,
  ) {}
  public async signEd25519(message: Uint8Array): Promise<Uint8Array> {
    return await this.signWithKms(this.keyId, message);
  }
}

export interface SignerAgentOptions {
  readonly socketPath: string;
  /** 32 bytes encoded as 64 hex characters; provision through a secret manager. */
  readonly authTokenHex: string;
  readonly backend: Ed25519HsmKmsDriver;
  readonly maxConnections?: number;
  readonly maxFrameBytes?: number;
}

interface SignerRequest {
  readonly version: number;
  readonly token: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}
interface SignerResponse {
  readonly version: number;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

function sameToken(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqualBuffer(a, b);
}
function timingSafeEqualBuffer(a: Buffer, b: Buffer): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh) && a.length === b.length;
}

function requestShape(value: unknown): SignerRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.version !== PROTOCOL_VERSION || typeof row.token !== 'string' ||
      typeof row.method !== 'string' || (row.params !== undefined &&
      (typeof row.params !== 'object' || row.params === null || Array.isArray(row.params)))) return undefined;
  const allowed = new Set(['version', 'token', 'method', 'params']);
  if (Object.keys(row).some((key) => !allowed.has(key))) return undefined;
  return row as unknown as SignerRequest;
}

interface ParsedPae {
  readonly payloadType: string;
  readonly payload: Buffer;
}

/** Strictly parse the DSSE v1 PAE at byte boundaries (lengths count bytes, not JS characters). */
function parsePae(value: Buffer): ParsedPae | undefined {
  const prefix = Buffer.from('DSSEv1 ', 'ascii');
  if (value.length < prefix.length || !value.subarray(0, prefix.length).equals(prefix)) return undefined;
  let offset = prefix.length;
  const readLength = (): number | undefined => {
    const separator = value.indexOf(0x20, offset);
    if (separator < 0) return undefined;
    const digits = value.subarray(offset, separator).toString('ascii');
    if (!/^(0|[1-9][0-9]*)$/.test(digits)) return undefined;
    const parsed = Number(digits);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
    offset = separator + 1;
    return parsed;
  };

  const typeLength = readLength();
  if (typeLength === undefined || typeLength > 512 || offset + typeLength >= value.length) return undefined;
  const typeBytes = value.subarray(offset, offset + typeLength);
  const payloadType = typeBytes.toString('utf8');
  if (!Buffer.from(payloadType, 'utf8').equals(typeBytes)) return undefined;
  offset += typeLength;
  if (value[offset] !== 0x20) return undefined;
  offset += 1;

  const payloadLength = readLength();
  if (payloadLength === undefined || payloadLength > MAX_FRAME_BYTES || value.length - offset !== payloadLength) {
    return undefined;
  }
  return { payloadType, payload: value.subarray(offset) };
}

/** The checkpoint key is deliberately scoped to signing canonical KEL tree heads only. */
function isAuthorizedCheckpointPae(value: Buffer, expectedKeyEpoch: string): boolean {
  const parsed = parsePae(value);
  if (!parsed || parsed.payloadType !== KEL_TREE_HEAD_PAYLOAD_TYPE) return false;
  let payload: unknown;
  try { payload = JSON.parse(parsed.payload.toString('utf8')) as unknown; }
  catch { return false; }
  try {
    if (!Buffer.from(canonicalizeJcs(payload), 'utf8').equals(parsed.payload)) return false;
  } catch {
    return false;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const head = payload as Record<string, unknown>;
  return head.schema === KEL_TREE_HEAD_SCHEMA &&
    typeof head.ledgerId === 'string' && head.ledgerId.length > 0 &&
    head.hashAlgorithm === 'sha256' && head.treeAlgorithm === 'rfc9162-sha256' &&
    typeof head.treeSize === 'string' && /^(0|[1-9][0-9]*)$/.test(head.treeSize) &&
    typeof head.keyEpoch === 'string' && head.keyEpoch === expectedKeyEpoch && /^(0|[1-9][0-9]*)$/.test(head.keyEpoch) &&
    typeof head.issuedAtEpochMs === 'string' && /^(0|[1-9][0-9]*)$/.test(head.issuedAtEpochMs) &&
    typeof head.rootHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(head.rootHash) &&
    (head.previousCheckpointDigest === null ||
      (typeof head.previousCheckpointDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(head.previousCheckpointDigest)));
}

function responseFrame(response: SignerResponse, maximum: number): Buffer {
  const body = Buffer.from(JSON.stringify(response), 'utf8');
  if (!body.length || body.length > maximum) throw new Error('signer response exceeds frame limit');
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

/**
 * Standalone local signer process API compatible with Rust ExternalSignerClient.
 * It holds a provider handle but never receives or serializes private key material.
 */
export class UnixSignerAgent {
  private server: Server | undefined;
  private active = 0;
  private readonly socketPath: string;
  private readonly token: string;
  private readonly backend: Ed25519HsmKmsDriver;
  private readonly maxConnections: number;
  private readonly maxFrameBytes: number;

  public constructor(options: SignerAgentOptions) {
    if (!options.socketPath || options.socketPath.includes('\0')) throw new TypeError('socketPath is required');
    if (!/^[a-fA-F0-9]{64}$/.test(options.authTokenHex)) throw new TypeError('signer token must be 32 bytes in hex');
    if (!options.backend.keyId || !/^(0|[1-9][0-9]*)$/.test(options.backend.keyEpoch) ||
        options.backend.publicKeyRaw.length !== 32) throw new TypeError('invalid Ed25519 provider metadata');
    this.socketPath = resolve(options.socketPath);
    this.token = options.authTokenHex;
    this.backend = options.backend;
    this.maxConnections = options.maxConnections ?? 8;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
    if (!Number.isSafeInteger(this.maxConnections) || this.maxConnections < 1 || this.maxConnections > 64) {
      throw new RangeError('maxConnections must be in 1..64');
    }
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes < 1024 || this.maxFrameBytes > MAX_FRAME_BYTES) {
      throw new RangeError('maxFrameBytes must be in 1024..65536');
    }
  }

  public async listen(): Promise<void> {
    const parent = dirname(this.socketPath);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const parentMeta = lstatSync(parent);
    if (parentMeta.isSymbolicLink() || !parentMeta.isDirectory() || (parentMeta.mode & 0o077) !== 0) {
      throw new Error('signer socket parent directory must be private and must not be a symlink');
    }
    try {
      const current = lstatSync(this.socketPath);
      if (current.isSymbolicLink() || !current.isSocket()) {
        throw new Error('refusing to replace non-socket signer path');
      }
      throw new Error('signer socket path already exists; verify the old signer is stopped before cleaning stale socket files');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const server = createServer((socket) => this.onConnection(socket));
    server.maxConnections = this.maxConnections;
    this.server = server;
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.removeListener('error', reject);
        chmodSync(this.socketPath, 0o600);
        resolvePromise();
      });
    });
  }

  public async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    });
    this.server = undefined;
    try { rmSync(this.socketPath); } catch { /* already removed by supervisor */ }
  }

  private onConnection(socket: Socket): void {
    if (this.active >= this.maxConnections) {
      socket.destroy();
      return;
    }
    this.active += 1;
    socket.setTimeout(5_000);
    socket.once('timeout', () => socket.destroy());
    socket.once('close', () => { this.active = Math.max(0, this.active - 1); });
    let accumulated = Buffer.alloc(0);
    let expected: number | undefined;

    socket.on('data', (chunk: Buffer) => {
      accumulated = Buffer.concat([accumulated, chunk]);
      if (accumulated.length > this.maxFrameBytes + 4) {
        socket.destroy();
        return;
      }
      if (expected === undefined && accumulated.length >= 4) {
        const length = accumulated.readUInt32BE(0);
        if (length < 1 || length > this.maxFrameBytes) {
          socket.destroy();
          return;
        }
        expected = length + 4;
      }
      if (expected !== undefined && accumulated.length >= expected) {
        if (accumulated.length !== expected) {
          socket.destroy();
          return;
        }
        socket.pause();
        void this.dispatch(accumulated.subarray(4)).then((response) => {
          socket.end(responseFrame(response, this.maxFrameBytes));
        }).catch(() => {
          socket.end(responseFrame({
            version: PROTOCOL_VERSION,
            error: { code: 'internal_error', message: 'signer operation failed' },
          }, this.maxFrameBytes));
        });
      }
    });
  }

  private async dispatch(bytes: Buffer): Promise<SignerResponse> {
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')) as unknown; }
    catch { return { version: PROTOCOL_VERSION, error: { code: 'invalid_json', message: 'invalid signer request JSON' } }; }
    const request = requestShape(value);
    if (!request) return { version: PROTOCOL_VERSION, error: { code: 'invalid_request', message: 'invalid signer request shape' } };
    if (!sameToken(this.token, request.token)) {
      return { version: PROTOCOL_VERSION, error: { code: 'unauthenticated', message: 'signer authentication failed' } };
    }
    if (request.method === 'signer.info') {
      if (Object.keys(request.params ?? {}).length !== 0) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_params', message: 'signer.info does not accept parameters' } };
      }
      return {
        version: PROTOCOL_VERSION,
        result: {
          keyId: this.backend.keyId,
          keyEpoch: this.backend.keyEpoch,
          publicKeyHex: Buffer.from(this.backend.publicKeyRaw).toString('hex'),
        },
      };
    }
    if (request.method === 'signer.sign') {
      const params = request.params ?? {};
      if (Object.keys(params).some((key) => !['keyId', 'payloadBase64'].includes(key)) ||
          params.keyId !== this.backend.keyId || typeof params.payloadBase64 !== 'string') {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_params', message: 'signer key ID or payload is invalid' } };
      }
      const payload = Buffer.from(params.payloadBase64, 'base64');
      if (payload.toString('base64') !== params.payloadBase64) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_payload', message: 'payload is not canonical Base64' } };
      }
      if (!isAuthorizedCheckpointPae(payload, this.backend.keyEpoch)) {
        return {
          version: PROTOCOL_VERSION,
          error: {
            code: 'signing_policy_violation',
            message: 'checkpoint keys only sign canonical KEL v1 tree-head DSSE PAE payloads',
          },
        };
      }
      const signature = Buffer.from(await this.backend.signEd25519(payload));
      if (signature.length !== 64) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_provider_signature', message: 'provider returned invalid Ed25519 signature length' } };
      }
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          Buffer.from(this.backend.publicKeyRaw),
        ]),
        format: 'der',
        type: 'spki',
      });
      if (!verify(null, payload, publicKey, signature)) {
        return { version: PROTOCOL_VERSION, error: { code: 'invalid_provider_signature', message: 'provider signature failed local verification' } };
      }
      return { version: PROTOCOL_VERSION, result: { signatureBase64: signature.toString('base64') } };
    }
    return { version: PROTOCOL_VERSION, error: { code: 'method_not_found', message: 'unknown signer method' } };
  }
}
