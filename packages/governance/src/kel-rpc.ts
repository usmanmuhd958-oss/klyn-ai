import { randomUUID, type KeyObject } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import {
  decodeSha256,
  digestJcs,
  verifyDsseEnvelope,
  verifyInclusionProof,
  KEL_EVIDENCE_PAYLOAD_TYPE,
  KEL_TREE_HEAD_PAYLOAD_TYPE,
  validateEvidenceStatement,
  type EvidenceStatementV1,
  type DsseEnvelopeV1,
  type KelAppendReceiptV1,
  type KelDaemonTransport,
  type TreeHeadV1,
  type VerificationReportV1,
} from './kel.js';
import { WitnessQuorumVerifier, type WitnessSignatureV1 } from './witness.js';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1_048_576;

interface RpcRequest {
  readonly version: 1;
  readonly id: string;
  readonly token: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}
interface RpcResponse<T> {
  readonly version: number;
  readonly id: string;
  readonly result?: T;
  readonly error?: { readonly code: string; readonly message: string };
}
export interface KelUnixSocketTransportOptions {
  readonly socketPath: string;
  /** Exactly 32 random bytes encoded as 64 hexadecimal characters. */
  readonly authTokenHex: string;
  /** Public checkpoint keys only; private keys must never be given to this client. */
  readonly trustedCheckpointKeys: ReadonlyMap<string, KeyObject>;
  readonly timeoutMs?: number;
}
export interface KelProofBundleV1 {
  readonly evidenceId: string;
  readonly evidenceEnvelope: DsseEnvelopeV1;
  readonly leaf: {
    readonly ledgerId: string;
    readonly sequence: string;
    readonly evidenceId: string;
    readonly envelopeDigest: string;
  };
  readonly proof: {
    readonly ledgerId: string;
    readonly leafIndex: string;
    readonly treeSize: string;
    readonly leafHash: string;
    readonly auditPath: readonly string[];
    readonly treeHeadEnvelopeDigest: string;
  };
  readonly checkpointEnvelope: DsseEnvelopeV1;
}

export class KelRpcError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'KelRpcError';
  }
}

/**
 * Node.js Unix socket client for the normative Rust daemon RPC.
 * Each request uses a fresh connection. Appends can be retried because evidenceId is
 * the daemon's idempotency key. The token is never sent in a CLI argument or URL.
 */
export class KelUnixSocketTransport implements KelDaemonTransport {
  private readonly socketPath: string;
  private readonly token: string;
  private readonly trustedCheckpointKeys: ReadonlyMap<string, KeyObject>;
  private readonly timeoutMs: number;

  public constructor(options: KelUnixSocketTransportOptions) {
    if (!options.socketPath || options.socketPath.includes('\0')) {
      throw new TypeError('socketPath is required and cannot contain NUL');
    }
    if (!/^[a-fA-F0-9]{64}$/.test(options.authTokenHex)) {
      throw new TypeError('authTokenHex must contain 32 bytes encoded as 64 hex characters');
    }
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new RangeError('timeoutMs must be between 1 and 120000');
    }
    this.socketPath = options.socketPath;
    this.token = options.authTokenHex;
    this.trustedCheckpointKeys = options.trustedCheckpointKeys;
    this.trustedProducerKeys = options.trustedProducerKeys;
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(method: string, params: Readonly<Record<string, unknown>>): Promise<T> {
    const id = randomUUID();
    const request: RpcRequest = { version: PROTOCOL_VERSION, id, token: this.token, method, params };
    const body = Buffer.from(JSON.stringify(request), 'utf8');
    if (body.length < 1 || body.length > MAX_FRAME_BYTES) {
      throw new RangeError('KEL RPC request exceeds maximum frame size');
    }
    const frame = Buffer.allocUnsafe(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);

    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      let accumulated = Buffer.alloc(0);
      let expectedBytes: number | undefined;
      const socket: Socket = connect({ path: this.socketPath });
      const timeout = setTimeout(() => finish(new Error('KEL RPC ' + method + ' timed out')), this.timeoutMs);

      const finish = (error?: Error, result?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve(result as T);
      };

      socket.once('error', (error) => finish(error));
      socket.once('connect', () => socket.write(frame));
      socket.on('data', (chunk: Buffer) => {
        accumulated = Buffer.concat([accumulated, chunk]);
        if (accumulated.length > MAX_FRAME_BYTES + 4) {
          finish(new Error('KEL RPC response exceeded maximum frame size'));
          return;
        }
        if (expectedBytes === undefined && accumulated.length >= 4) {
          const length = accumulated.readUInt32BE(0);
          if (length < 1 || length > MAX_FRAME_BYTES) {
            finish(new Error('KEL RPC response has invalid frame length'));
            return;
          }
          expectedBytes = 4 + length;
        }
        if (expectedBytes !== undefined && accumulated.length >= expectedBytes) {
          if (accumulated.length !== expectedBytes) {
            finish(new Error('KEL RPC server returned more than one response'));
            return;
          }
          let response: RpcResponse<T>;
          try {
            response = JSON.parse(accumulated.subarray(4).toString('utf8')) as RpcResponse<T>;
          } catch {
            finish(new Error('KEL RPC response was not valid JSON'));
            return;
          }
          if (response.version !== PROTOCOL_VERSION || response.id !== id) {
            finish(new Error('KEL RPC response version or request id mismatch'));
            return;
          }
          if (response.error) {
            finish(new KelRpcError(response.error.code, response.error.message));
            return;
          }
          if (!Object.hasOwn(response, 'result')) {
            finish(new Error('KEL RPC response omitted result'));
            return;
          }
          finish(undefined, response.result);
        }
      });
      socket.once('end', () => {
        if (!settled) finish(new Error('KEL RPC connection closed before a complete response'));
      });
    });
  }

  public async appendEvidence(
    envelope: DsseEnvelopeV1,
    _acceptedAtEpochMs: string,
  ): Promise<KelAppendReceiptV1> {
    // The Rust daemon supplies the authoritative accepted timestamp from its own clock.
    const receipt = await this.request<KelAppendReceiptV1>('evidence.append', { envelope });
    if (!receipt || receipt.evidenceId === '' || receipt.sequence === '' ||
        receipt.treeSize === '' || receipt.rootHash === '') {
      throw new Error('KEL daemon returned a malformed append receipt');
    }
    return receipt;
  }

  public async getProof(evidenceId: string): Promise<KelProofBundleV1> {
    if (!evidenceId || evidenceId.length > 256) throw new TypeError('invalid evidenceId');
    return await this.request<KelProofBundleV1>('proof.get', { evidenceId });
  }

  public async health(): Promise<{ ledgerId: string; treeSize: string; rootHash: string }> {
    return await this.request('ledger.health', {});
  }

  public async verifyEvidence(evidenceId: string): Promise<VerificationReportV1> {
    return this.verifyBundle(await this.getProof(evidenceId), evidenceId);
  }

  /**
   * Complete a trust decision only after producer, inclusion, checkpoint, independent
   * witness quorum, and caller-defined evidence policy checks all pass. The callback
   * must validate the semantics of the evidence, not merely its signature.
   */
  public async verifyEvidenceWithWitnesses(
    evidenceId: string,
    witnessSignatures: readonly WitnessSignatureV1[],
    witnessVerifier: WitnessQuorumVerifier,
    nowEpochMs: string,
    evaluateEvidencePolicy: (statement: EvidenceStatementV1) => boolean,
  ): Promise<VerificationReportV1> {
    const bundle = await this.getProof(evidenceId);
    const base = this.verifyBundle(bundle, evidenceId);
    let witnessQuorum: VerificationReportV1['witnessQuorum'] = 'fail';
    let evidencePolicy: VerificationReportV1['evidencePolicy'] = 'fail';
    const reasonCodes = [...base.reasonCodes];

    try {
      const result = witnessVerifier.verify(bundle.checkpointEnvelope, witnessSignatures, nowEpochMs);
      witnessQuorum = result.accepted ? 'pass' : 'fail';
      for (const code of result.reasonCodes) reasonCodes.push(code);
      for (const rejection of result.rejected) {
        reasonCodes.push('witness:' + rejection.witnessId + ':' + rejection.code);
      }
    } catch {
      reasonCodes.push('witness-verification-error');
    }

    try {
      const value = verifyDsseEnvelope(
        bundle.evidenceEnvelope,
        KEL_EVIDENCE_PAYLOAD_TYPE,
        this.trustedProducerKeys,
      );
      const statement = value as unknown as EvidenceStatementV1;
      validateEvidenceStatement(statement);
      if (statement.evidenceId !== evidenceId || statement.ledgerId !== bundle.leaf.ledgerId ||
          digestJcs(bundle.evidenceEnvelope) !== bundle.leaf.envelopeDigest) {
        throw new Error('evidence envelope does not match ledger leaf');
      }
      evidencePolicy = evaluateEvidencePolicy(statement) ? 'pass' : 'fail';
      if (evidencePolicy === 'fail') reasonCodes.push('evidence-policy-rejected');
    } catch {
      evidencePolicy = 'fail';
      reasonCodes.push('producer-envelope-or-policy-invalid');
    }

    const accepted = base.ledgerIntegrity === 'pass' &&
      base.producerAuthentication === 'pass' &&
      base.inclusion === 'pass' &&
      base.checkpointAuthentication === 'pass' &&
      witnessQuorum === 'pass' &&
      evidencePolicy === 'pass';
    if (!accepted && reasonCodes.length === 0) reasonCodes.push('verification-incomplete');
    return { ...base, witnessQuorum, evidencePolicy, accepted, reasonCodes };
  }

  private verifyBundle(bundle: KelProofBundleV1, evidenceId: string): VerificationReportV1 {
    const reasonCodes: string[] = [];
    let producerAuthentication: VerificationReportV1['producerAuthentication'] = 'fail';
    let checkpointAuthentication: VerificationReportV1['checkpointAuthentication'] = 'fail';
    let ledgerIntegrity: VerificationReportV1['ledgerIntegrity'] = 'fail';
    let inclusion: VerificationReportV1['inclusion'] = 'fail';

    try {
      const producerValue = verifyDsseEnvelope(
        bundle.evidenceEnvelope,
        KEL_EVIDENCE_PAYLOAD_TYPE,
        this.trustedProducerKeys,
      );
      const statement = producerValue as unknown as EvidenceStatementV1;
      validateEvidenceStatement(statement);
      if (statement.evidenceId !== evidenceId || statement.ledgerId !== bundle.leaf.ledgerId ||
          digestJcs(bundle.evidenceEnvelope) !== bundle.leaf.envelopeDigest ||
          bundle.leaf.evidenceId !== evidenceId) {
        throw new Error('producer envelope does not match ledger leaf');
      }
      producerAuthentication = 'pass';
    } catch {
      reasonCodes.push('producer-authentication-failed');
    }

    try {
      const headValue = verifyDsseEnvelope(
        bundle.checkpointEnvelope,
        KEL_TREE_HEAD_PAYLOAD_TYPE,
        this.trustedCheckpointKeys,
      );
      const head = headValue as unknown as TreeHeadV1;
      checkpointAuthentication = 'pass';
      if (head.ledgerId !== bundle.leaf.ledgerId ||
          head.ledgerId !== bundle.proof.ledgerId ||
          head.treeSize !== bundle.proof.treeSize ||
          digestJcs(bundle.checkpointEnvelope) !== bundle.proof.treeHeadEnvelopeDigest) {
        reasonCodes.push('checkpoint-proof-binding-mismatch');
      } else {
        const index = Number(bundle.proof.leafIndex);
        const size = Number(bundle.proof.treeSize);
        const safeNumbers = Number.isSafeInteger(index) && Number.isSafeInteger(size);
        const rootHash = head.rootHash.startsWith('sha256:') ? head.rootHash.slice(7) : head.rootHash;
        if (safeNumbers && verifyInclusionProof(
          decodeSha256(bundle.proof.leafHash), index, size, bundle.proof.auditPath, rootHash,
        )) {
          inclusion = 'pass';
          ledgerIntegrity = 'pass';
        } else {
          reasonCodes.push('inclusion-proof-invalid');
        }
      }
    } catch {
      reasonCodes.push('checkpoint-or-proof-invalid');
    }

    if (bundle.evidenceId !== evidenceId || bundle.leaf.evidenceId !== evidenceId) {
      reasonCodes.push('evidence-id-mismatch');
      inclusion = 'fail';
      ledgerIntegrity = 'fail';
    }
    // A valid inclusion proof is not, by itself, a full KEL trust decision. Independent
    // witness quorum and domain-specific evidence policy must also be satisfied.
    const accepted = false;
    if (reasonCodes.length === 0) reasonCodes.push('witness-quorum-and-evidence-policy-required');

    return {
      ledgerIntegrity,
      producerAuthentication,
      inclusion,
      checkpointAuthentication,
      consistency: 'unknown',
      witnessQuorum: 'unknown',
      evidencePolicy: 'unknown',
      accepted,
      reasonCodes,
    };
  }
}
