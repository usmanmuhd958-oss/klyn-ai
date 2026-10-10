/**
 * KEL v1 TypeScript control-plane primitives.
 *
 * The native Rust klyn-evidence crate is normative. This bridge uses strict
 * JSON-only inputs and the same RFC 8785-compatible ECMAScript number/string
 * serialization and RFC 9162 Merkle domain separators.
 */
import { createHash, type KeyObject } from 'node:crypto';
import { verifyEd25519 } from './crypto.js';
import type { JsonValue } from './types.js';

export const KEL_EVIDENCE_SCHEMA = 'urn:klyn:evidence:v1';
export const KEL_LEAF_SCHEMA = 'urn:klyn:ledger-leaf:v1';
export const KEL_TREE_HEAD_SCHEMA = 'urn:klyn:tree-head:v1';
export const KEL_EVIDENCE_PAYLOAD_TYPE = 'application/vnd.klyn.evidence.v1+json';
export const KEL_TREE_HEAD_PAYLOAD_TYPE = 'application/vnd.klyn.tree-head.v1+json';

export type KelEvidenceKind =
  | 'intent-accepted'
  | 'plan-accepted'
  | 'authorization-decision'
  | 'execution-started'
  | 'execution-completed'
  | 'verification-completed'
  | 'mutation-committed'
  | 'rollback-completed';

export type KelEvidenceStatus = 'pass' | 'fail' | 'blocked' | 'unknown';

export interface EvidenceContextV1 {
  readonly intentDigest: string;
  readonly planDigest: string;
  readonly policyDigest: string;
  readonly sourceTreeDigest: string;
  readonly runtimeImageDigest: string;
}

export interface EvidenceSubjectV1 {
  readonly repositoryUri: string;
  readonly baseRevision: string;
  readonly resultingTreeDigest: string | null;
  readonly changeDigest: string | null;
}

export interface EvidenceOutcomeV1 {
  readonly status: KelEvidenceStatus;
  readonly exitCode: string | null;
  readonly stdoutDigest: string | null;
  readonly stderrDigest: string | null;
  readonly startedAtEpochMs: string;
  readonly finishedAtEpochMs: string;
}

export interface ArtifactReferenceV1 {
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: string;
  readonly digest: string;
}

export interface EvidenceStatementV1 {
  readonly schema: typeof KEL_EVIDENCE_SCHEMA;
  readonly ledgerId: string;
  readonly evidenceId: string;
  readonly runId: string;
  readonly sequenceInRun: string;
  readonly kind: KelEvidenceKind;
  readonly producerId: string;
  readonly context: EvidenceContextV1;
  readonly subject: EvidenceSubjectV1;
  readonly outcome: EvidenceOutcomeV1;
  readonly artifacts: readonly ArtifactReferenceV1[];
  readonly extensions: Readonly<Record<string, JsonValue>>;
}

export interface DsseSignatureV1 {
  readonly keyid: string;
  readonly sig: string;
}

export interface DsseEnvelopeV1 {
  readonly payloadType: string;
  readonly payload: string;
  readonly signatures: readonly DsseSignatureV1[];
}

export interface LedgerLeafV1 {
  readonly schema: typeof KEL_LEAF_SCHEMA;
  readonly ledgerId: string;
  readonly sequence: string;
  readonly evidenceId: string;
  readonly runId: string;
  readonly kind: KelEvidenceKind;
  readonly envelopeDigest: string;
  readonly previousLeafHash: string | null;
  readonly acceptedAtEpochMs: string;
}

export interface TreeHeadV1 {
  readonly schema: typeof KEL_TREE_HEAD_SCHEMA;
  readonly ledgerId: string;
  readonly hashAlgorithm: 'sha256';
  readonly treeAlgorithm: 'rfc9162-sha256';
  readonly treeSize: string;
  readonly rootHash: string;
  readonly previousCheckpointDigest: string | null;
  readonly keyEpoch: string;
  readonly issuedAtEpochMs: string;
}

export interface InclusionProofV1 {
  readonly ledgerId: string;
  readonly leafIndex: string;
  readonly treeSize: string;
  readonly leafHash: string;
  readonly auditPath: readonly string[];
  readonly treeHeadEnvelopeDigest: string;
}

export function canonicalizeJcs(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string') {
      assertUnicodeScalarString(item);
      return JSON.stringify(item);
    }
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('JCS forbids non-finite numbers');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('KEL JCS accepts only JSON values');
    if (ancestors.has(item)) throw new TypeError('cyclic values are not JSON');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const entries: string[] = [];
        for (let i = 0; i < item.length; i += 1) {
          if (!(i in item)) throw new TypeError('sparse arrays are not valid KEL JSON');
          entries.push(encode(item[i]));
        }
        return '[' + entries.join(',') + ']';
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('KEL JCS requires plain JSON objects');
      }
      const record = item as Record<string, unknown>;
      const keys = Object.keys(record).sort(); // ECMAScript UTF-16 code-unit ordering (RFC 8785).
      const entries = keys.map((key) => {
        assertUnicodeScalarString(key);
        if (record[key] === undefined) throw new TypeError('undefined is not a JSON value');
        return JSON.stringify(key) + ':' + encode(record[key]);
      });
      return '{' + entries.join(',') + '}';
    } finally {
      ancestors.delete(item);
    }
  };
  return encode(value);
}

function assertUnicodeScalarString(value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('unpaired high surrogate is invalid JCS input');
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('unpaired low surrogate is invalid JCS input');
    }
  }
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

export function sha256Hex(data: Uint8Array): string {
  return Buffer.from(sha256Bytes(data)).toString('hex');
}

export function digestJcs(value: unknown): string {
  return 'sha256:' + sha256Hex(Buffer.from(canonicalizeJcs(value), 'utf8'));
}

export function validateDigest(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError('digest must be sha256: followed by 64 lowercase hexadecimal characters');
  }
}

export function decodeSha256(value: string): Uint8Array {
  const raw = value.startsWith('sha256:') ? value.slice(7) : value;
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new TypeError('expected lowercase SHA-256 hex digest');
  return new Uint8Array(Buffer.from(raw, 'hex'));
}

export function merkleLeafHash(canonicalLeafBytes: Uint8Array): Uint8Array {
  return sha256Bytes(Buffer.concat([Buffer.from([0x00]), Buffer.from(canonicalLeafBytes)]));
}

export function merkleNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== 32 || right.length !== 32) throw new TypeError('Merkle child hashes must be 32 bytes');
  return sha256Bytes(Buffer.concat([Buffer.from([0x01]), Buffer.from(left), Buffer.from(right)]));
}

function splitPoint(size: number): number {
  if (!Number.isSafeInteger(size) || size <= 1) throw new RangeError('splitPoint requires size > 1');
  let power = 1;
  while (power < size) power *= 2;
  return power / 2;
}

export function merkleRoot(hashes: readonly Uint8Array[]): Uint8Array {
  if (hashes.length === 0) return sha256Bytes(new Uint8Array());
  if (hashes.length === 1) {
    if (hashes[0]?.length !== 32) throw new TypeError('leaf hash must be 32 bytes');
    return hashes[0];
  }
  const k = splitPoint(hashes.length);
  return merkleNodeHash(merkleRoot(hashes.slice(0, k)), merkleRoot(hashes.slice(k)));
}

function buildInclusionPath(index: number, hashes: readonly Uint8Array[], path: Uint8Array[]): void {
  if (hashes.length <= 1) return;
  const k = splitPoint(hashes.length);
  if (index < k) {
    buildInclusionPath(index, hashes.slice(0, k), path);
    path.push(merkleRoot(hashes.slice(k)));
  } else {
    buildInclusionPath(index - k, hashes.slice(k), path);
    path.push(merkleRoot(hashes.slice(0, k)));
  }
}

export function createInclusionProof(hashes: readonly Uint8Array[], index: number): readonly string[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= hashes.length) throw new RangeError('invalid leaf index');
  const path: Uint8Array[] = [];
  buildInclusionPath(index, hashes, path);
  return path.map((hash) => Buffer.from(hash).toString('hex'));
}

function verifyPath(index: number, size: number, leaf: Uint8Array, path: readonly Uint8Array[], cursor: { value: number }): Uint8Array {
  if (size === 1) return leaf;
  const k = splitPoint(size);
  if (index < k) {
    const left = verifyPath(index, k, leaf, path, cursor);
    const right = path[cursor.value++];
    if (!right) throw new Error('truncated inclusion proof');
    return merkleNodeHash(left, right);
  }
  const right = verifyPath(index - k, size - k, leaf, path, cursor);
  const left = path[cursor.value++];
  if (!left) throw new Error('truncated inclusion proof');
  return merkleNodeHash(left, right);
}

export function verifyInclusionProof(
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  proofHex: readonly string[],
  expectedRootHex: string,
): boolean {
  try {
    if (leaf.length !== 32 || !Number.isSafeInteger(treeSize) || treeSize < 1 || index < 0 || index >= treeSize) return false;
    const proof = proofHex.map((item) => decodeSha256(item));
    const cursor = { value: 0 };
    const root = verifyPath(index, treeSize, leaf, proof, cursor);
    return cursor.value === proof.length && Buffer.from(root).toString('hex') === expectedRootHex;
  } catch {
    return false;
  }
}

export function validateEvidenceStatement(value: EvidenceStatementV1): void {
  if (value.schema !== KEL_EVIDENCE_SCHEMA) throw new TypeError('unsupported evidence schema');
  for (const [name, item] of Object.entries({
    ledgerId: value.ledgerId, evidenceId: value.evidenceId, runId: value.runId,
    producerId: value.producerId, sequenceInRun: value.sequenceInRun,
    startedAtEpochMs: value.outcome.startedAtEpochMs, finishedAtEpochMs: value.outcome.finishedAtEpochMs,
  })) {
    if (typeof item !== 'string' || item.length === 0) throw new TypeError(name + ' is required');
  }
  for (const digest of [
    value.context.intentDigest, value.context.planDigest, value.context.policyDigest,
    value.context.sourceTreeDigest, value.context.runtimeImageDigest,
    value.subject.resultingTreeDigest, value.subject.changeDigest,
    value.outcome.stdoutDigest, value.outcome.stderrDigest,
    ...value.artifacts.map((artifact) => artifact.digest),
  ]) {
    if (digest !== null) validateDigest(digest);
  }
  for (const number of [value.sequenceInRun, value.outcome.startedAtEpochMs, value.outcome.finishedAtEpochMs]) {
    if (!/^(0|[1-9][0-9]*)$/.test(number)) throw new TypeError('sequence and timestamps must be decimal integer strings');
  }
  for (const artifact of value.artifacts) {
    if (!artifact.name || !artifact.mediaType || !/^(0|[1-9][0-9]*)$/.test(artifact.sizeBytes)) {
      throw new TypeError('invalid artifact reference');
    }
  }
}


export interface ConsistencyProofV1 {
  readonly ledgerId: string;
  readonly oldTreeSize: string;
  readonly newTreeSize: string;
  readonly oldRootHash: string;
  readonly newRootHash: string;
  readonly auditPath: readonly string[];
}

function buildConsistencySubproof(
  oldSize: number,
  hashes: readonly Uint8Array[],
  complete: boolean,
  proof: Uint8Array[],
): void {
  const size = hashes.length;
  if (oldSize === size) {
    if (!complete) proof.push(merkleRoot(hashes));
    return;
  }
  const k = splitPoint(size);
  if (oldSize <= k) {
    buildConsistencySubproof(oldSize, hashes.slice(0, k), complete, proof);
    proof.push(merkleRoot(hashes.slice(k)));
  } else {
    buildConsistencySubproof(oldSize - k, hashes.slice(k), false, proof);
    proof.push(merkleRoot(hashes.slice(0, k)));
  }
}

export function createConsistencyProof(hashes: readonly Uint8Array[], oldSize: number): readonly string[] {
  if (!Number.isSafeInteger(oldSize) || oldSize < 0 || oldSize > hashes.length) {
    throw new RangeError('old tree size must be within the new tree');
  }
  if (oldSize === 0 || oldSize === hashes.length) return [];
  const proof: Uint8Array[] = [];
  buildConsistencySubproof(oldSize, hashes, true, proof);
  return proof.map((hash) => Buffer.from(hash).toString('hex'));
}

/** RFC 9162 consistency verifier; proof elements are lowercase SHA-256 hex. */
export function verifyConsistencyProof(
  oldSize: number,
  newSize: number,
  oldRootHex: string,
  newRootHex: string,
  proofHex: readonly string[],
): boolean {
  try {
    if (!Number.isSafeInteger(oldSize) || !Number.isSafeInteger(newSize) ||
        oldSize < 0 || newSize < oldSize) return false;
    const oldRoot = decodeSha256(oldRootHex);
    const newRoot = decodeSha256(newRootHex);
    if (oldSize === 0) return true;
    if (oldSize === newSize) {
      return proofHex.length === 0 && Buffer.from(oldRoot).equals(Buffer.from(newRoot));
    }
    if (proofHex.length === 0) return false;
    const proof = proofHex.map(decodeSha256);
    let fn = oldSize - 1;
    let sn = newSize - 1;
    while ((fn & 1) === 1) { fn >>= 1; sn >>= 1; }
    let firstRoot: Uint8Array;
    let secondRoot: Uint8Array;
    let cursor: number;
    if (fn === 0) {
      firstRoot = oldRoot;
      secondRoot = oldRoot;
      cursor = 0;
    } else {
      firstRoot = proof[0]!;
      secondRoot = proof[0]!;
      cursor = 1;
    }
    while (cursor < proof.length) {
      const item = proof[cursor]!;
      if ((fn & 1) === 1 || fn === sn) {
        firstRoot = merkleNodeHash(item, firstRoot);
        secondRoot = merkleNodeHash(item, secondRoot);
        while (fn !== 0 && (fn & 1) === 0) { fn >>= 1; sn >>= 1; }
      } else {
        secondRoot = merkleNodeHash(secondRoot, item);
      }
      fn >>= 1;
      sn >>= 1;
      cursor += 1;
    }
    return Buffer.from(firstRoot).equals(Buffer.from(oldRoot)) &&
      Buffer.from(secondRoot).equals(Buffer.from(newRoot));
  } catch {
    return false;
  }
}


export function dssePreAuthEncoding(payloadType: string, payload: Uint8Array): Uint8Array {
  if (!payloadType) throw new TypeError('DSSE payload type is required');
  const typeBytes = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from('DSSEv1 ' + typeBytes.length + ' ', 'utf8'),
    typeBytes,
    Buffer.from(' ' + payload.length + ' ', 'utf8'),
    Buffer.from(payload),
  ]);
}

export function verifyDsseEnvelope(
  envelope: DsseEnvelopeV1,
  expectedPayloadType: string,
  trustedKeys: ReadonlyMap<string, KeyObject>,
): JsonValue {
  if (envelope.payloadType !== expectedPayloadType || envelope.signatures.length === 0) {
    throw new TypeError('invalid DSSE payload type or empty signatures');
  }
  const payloadBytes = Buffer.from(envelope.payload, 'base64');
  if (payloadBytes.toString('base64') !== envelope.payload) throw new TypeError('payload is not canonical Base64');
  const canonical = Buffer.from(canonicalizeJcs(JSON.parse(payloadBytes.toString('utf8'))), 'utf8');
  if (!canonical.equals(payloadBytes)) throw new TypeError('DSSE payload is not canonical JCS');
  const pae = dssePreAuthEncoding(envelope.payloadType, payloadBytes).toString('utf8');
  const valid = envelope.signatures.some((signature) => {
    const key = trustedKeys.get(signature.keyid);
    if (!key) return false;
    const signatureBytes = Buffer.from(signature.sig, 'base64');
    if (signatureBytes.toString('base64') !== signature.sig) return false;
    return verifyEd25519(pae, signature.sig, key);
  });
  if (!valid) throw new TypeError('no trusted DSSE signature verified');
  return JSON.parse(payloadBytes.toString('utf8')) as JsonValue;
}

export interface KelAppendReceiptV1 {
  readonly ledgerId: string;
  readonly sequence: string;
  readonly evidenceId: string;
  readonly envelopeDigest: string;
  readonly leafHash: string;
  readonly treeSize: string;
  readonly rootHash: string;
  readonly checkpointEnvelope: DsseEnvelopeV1;
  readonly idempotentReplay: boolean;
}

export interface KelDaemonTransport {
  appendEvidence(envelope: DsseEnvelopeV1, acceptedAtEpochMs: string): Promise<KelAppendReceiptV1>;
  verifyEvidence(evidenceId: string): Promise<VerificationReportV1>;
}

export interface VerificationReportV1 {
  readonly ledgerIntegrity: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly producerAuthentication: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly inclusion: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly checkpointAuthentication: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly consistency: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly witnessQuorum: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly evidencePolicy: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  readonly accepted: boolean;
  readonly reasonCodes: readonly string[];
}

export class KelBridge {
  public constructor(
    private readonly transport: KelDaemonTransport,
    private readonly trustedProducerKeys: ReadonlyMap<string, KeyObject>,
  ) {}

  public async submit(
    envelope: DsseEnvelopeV1,
    acceptedAtEpochMs: string,
  ): Promise<{ receipt: KelAppendReceiptV1; verification: VerificationReportV1 }> {
    if (!/^(0|[1-9][0-9]*)$/.test(acceptedAtEpochMs)) {
      throw new TypeError('acceptedAtEpochMs must be a decimal integer string');
    }
    const decoded = verifyDsseEnvelope(envelope, KEL_EVIDENCE_PAYLOAD_TYPE, this.trustedProducerKeys);
    const statement = decoded as unknown as EvidenceStatementV1;
    validateEvidenceStatement(statement);
    const payloadBytes = Buffer.from(envelope.payload, 'base64');
    if (!Buffer.from(canonicalizeJcs(statement), 'utf8').equals(payloadBytes)) {
      throw new TypeError('evidence statement and DSSE payload differ');
    }
    const receipt = await this.transport.appendEvidence(envelope, acceptedAtEpochMs);
    if (receipt.evidenceId !== statement.evidenceId || receipt.ledgerId !== statement.ledgerId) {
      throw new TypeError('daemon receipt does not match submitted evidence');
    }
    const verification = await this.transport.verifyEvidence(statement.evidenceId);
    return { receipt, verification };
  }
}
