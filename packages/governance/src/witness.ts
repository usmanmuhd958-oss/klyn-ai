import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  KEL_TREE_HEAD_PAYLOAD_TYPE,
  KEL_TREE_HEAD_SCHEMA,
  canonicalizeJcs,
  digestJcs,
  verifyDsseEnvelope,
  validateDigest,
  type DsseEnvelopeV1,
  type TreeHeadV1,
} from './kel.js';

export type KelKeyPurposeV1 = 'producer' | 'checkpoint' | 'witness';

export interface KeyRecordV1 {
  readonly keyId: string;
  readonly subjectId: string;
  readonly purpose: KelKeyPurposeV1;
  /** Monotonically increasing decimal epoch scoped to this subject and purpose. */
  readonly epoch: string;
  /** Ed25519 public key in SPKI DER, Base64 encoded. Private key material is forbidden. */
  readonly publicKeySpkiBase64: string;
  readonly notBeforeEpochMs: string;
  readonly notAfterEpochMs: string;
  /** Any non-null value revokes the key retroactively for verification. */
  readonly revokedAtEpochMs: string | null;
}
export interface KeyRegistryStateV1 {
  readonly schema: 'urn:klyn:key-registry:v1';
  readonly revision: string;
  readonly records: readonly KeyRecordV1[];
}
export interface KeyRegistryStorage {
  load(): KeyRegistryStateV1 | undefined;
  save(state: KeyRegistryStateV1): void;
}

export class InMemoryKeyRegistryStorage implements KeyRegistryStorage {
  private state: KeyRegistryStateV1 | undefined;
  public load(): KeyRegistryStateV1 | undefined {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }
  public save(state: KeyRegistryStateV1): void {
    this.state = structuredClone(state);
  }
}

/**
 * Durable single-writer key-registry storage. Writes use a mode-0600 temporary file,
 * fsync the file and containing directory, then atomically rename into place. For a
 * multi-process or multi-host deployment, use a transactional database adapter instead.
 */
export class JsonFileKeyRegistryStorage implements KeyRegistryStorage {
  private readonly filePath: string;

  public constructor(filePath: string) {
    if (!filePath || filePath.includes('\0')) throw new TypeError('registry file path is required');
    this.filePath = resolve(filePath);
  }

  public load(): KeyRegistryStateV1 | undefined {
    let metadata;
    try {
      metadata = lstatSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new KeyLifecycleError('registry_file_type', 'registry path must be a regular file, not a symlink');
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new KeyLifecycleError('registry_file_permissions', 'registry file permissions must be 0600');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
    } catch {
      throw new KeyLifecycleError('registry_file_invalid', 'registry file is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null ||
        (parsed as { schema?: unknown }).schema !== 'urn:klyn:key-registry:v1' ||
        !Array.isArray((parsed as { records?: unknown }).records)) {
      throw new KeyLifecycleError('registry_file_invalid', 'registry file has an invalid schema');
    }
    return parsed as KeyRegistryStateV1;
  }

  public save(state: KeyRegistryStateV1): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const metadata = lstatSync(this.filePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new KeyLifecycleError('registry_file_type', 'registry path must be a regular file, not a symlink');
      }
      const current = JSON.parse(readFileSync(this.filePath, 'utf8')) as KeyRegistryStateV1;
      if (BigInt(current.revision) + 1n !== BigInt(state.revision)) {
        throw new KeyLifecycleError('registry_revision_conflict', 'registry revision changed concurrently; reload before retry');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (state.revision !== '1') {
        throw new KeyLifecycleError('registry_revision_conflict', 'registry disappeared during update');
      }
    }

    const temporary = this.filePath + '.' + process.pid + '.' + randomUUID() + '.tmp';
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(fileDescriptor, JSON.stringify(state), { encoding: 'utf8' });
      fsyncSync(fileDescriptor);
      closeSync(fileDescriptor);
      fileDescriptor = undefined;
      renameSync(temporary, this.filePath);
      const directoryDescriptor = openSync(directory, 'r');
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    } catch (error) {
      if (fileDescriptor !== undefined) {
        try { closeSync(fileDescriptor); } catch { /* preserve the original I/O error */ }
      }
      try { unlinkSync(temporary); } catch { /* temporary file may already have been renamed */ }
      throw error;
    }
  }
}

export class KeyLifecycleError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'KeyLifecycleError';
  }
}

function decimal(value: string, name: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(name + ' must be an unsigned decimal integer string');
  }
  return BigInt(value);
}
function validateRecord(record: KeyRecordV1): void {
  if (!record.keyId || record.keyId.length > 256 || !record.subjectId ||
      record.subjectId.length > 256 || !['producer', 'checkpoint', 'witness'].includes(record.purpose)) {
    throw new TypeError('invalid key record identity or purpose');
  }
  decimal(record.epoch, 'key epoch');
  const starts = decimal(record.notBeforeEpochMs, 'notBeforeEpochMs');
  const ends = decimal(record.notAfterEpochMs, 'notAfterEpochMs');
  if (starts >= ends) throw new TypeError('key validity interval must be non-empty');
  if (record.revokedAtEpochMs !== null) decimal(record.revokedAtEpochMs, 'revokedAtEpochMs');
  const raw = Buffer.from(record.publicKeySpkiBase64, 'base64');
  if (raw.length === 0 || raw.toString('base64') !== record.publicKeySpkiBase64) {
    throw new TypeError('public key must be canonical Base64 DER');
  }
  const key = createPublicKey({ key: raw, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') {
    throw new TypeError('only Ed25519 public keys are accepted');
  }
}
function cloneRecord(record: KeyRecordV1): KeyRecordV1 {
  return { ...record };
}

export interface RegisterKeyInputV1 extends Omit<KeyRecordV1, 'revokedAtEpochMs'> {
  readonly revokedAtEpochMs?: null;
}

export class KeyLifecycleRegistry {
  private records: KeyRecordV1[];
  private revision: bigint;

  public constructor(private readonly storage: KeyRegistryStorage) {
    const loaded = storage.load();
    if (loaded === undefined) {
      this.records = [];
      this.revision = 0n;
      this.persist();
    } else {
      if (loaded.schema !== 'urn:klyn:key-registry:v1') {
        throw new KeyLifecycleError('registry_schema', 'unsupported key registry schema');
      }
      this.revision = decimal(loaded.revision, 'registry revision');
      this.records = loaded.records.map(cloneRecord);
      const ids = new Set<string>();
      for (const record of this.records) {
        validateRecord(record);
        if (ids.has(record.keyId)) throw new KeyLifecycleError('registry_duplicate_key', 'duplicate key id in registry');
        ids.add(record.keyId);
      }
    }
  }

  private persist(): void {
    this.revision += 1n;
    const state: KeyRegistryStateV1 = {
      schema: 'urn:klyn:key-registry:v1',
      revision: this.revision.toString(),
      records: this.records.map(cloneRecord),
    };
    this.storage.save(state);
  }

  public snapshot(): KeyRegistryStateV1 {
    return {
      schema: 'urn:klyn:key-registry:v1',
      revision: this.revision.toString(),
      records: this.records.map(cloneRecord),
    };
  }

  public register(input: RegisterKeyInputV1): void {
    const record: KeyRecordV1 = { ...input, revokedAtEpochMs: null };
    validateRecord(record);
    if (this.records.some((item) => item.keyId === record.keyId)) {
      throw new KeyLifecycleError('key_id_exists', 'key id already exists; key ids are never reused');
    }
    const sameEpoch = this.records.some((item) =>
      item.subjectId === record.subjectId && item.purpose === record.purpose && item.epoch === record.epoch,
    );
    if (sameEpoch) throw new KeyLifecycleError('epoch_exists', 'key epoch already exists for this subject and purpose');
    const maxEpoch = this.records
      .filter((item) => item.subjectId === record.subjectId && item.purpose === record.purpose)
      .reduce((max, item) => decimal(item.epoch, 'key epoch') > max ? decimal(item.epoch, 'key epoch') : max, 0n);
    if (decimal(record.epoch, 'key epoch') <= maxEpoch) {
      throw new KeyLifecycleError('epoch_not_monotonic', 'new key epochs must increase monotonically');
    }
    this.records.push(record);
    this.persist();
  }

  public rotate(previousKeyId: string, nextInput: RegisterKeyInputV1, effectiveAtEpochMs: string): void {
    const effectiveAt = decimal(effectiveAtEpochMs, 'effectiveAtEpochMs');
    const previousIndex = this.records.findIndex((record) => record.keyId === previousKeyId);
    if (previousIndex < 0) throw new KeyLifecycleError('key_not_found', 'previous key is not registered');
    const previous = this.records[previousIndex]!;
    if (previous.revokedAtEpochMs !== null) throw new KeyLifecycleError('key_revoked', 'previous key is already revoked');
    if (decimal(previous.notBeforeEpochMs, 'notBeforeEpochMs') > effectiveAt ||
        decimal(previous.notAfterEpochMs, 'notAfterEpochMs') <= effectiveAt) {
      throw new KeyLifecycleError('key_not_active', 'previous key is not active at rotation time');
    }
    if (nextInput.subjectId !== previous.subjectId || nextInput.purpose !== previous.purpose) {
      throw new KeyLifecycleError('rotation_identity_mismatch', 'rotation must preserve subject and key purpose');
    }
    const maximumEpoch = this.records
      .filter((record) => record.subjectId === previous.subjectId && record.purpose === previous.purpose)
      .reduce((maximum, record) => decimal(record.epoch, 'key epoch') > maximum ? decimal(record.epoch, 'key epoch') : maximum, 0n);
    if (decimal(nextInput.epoch, 'next key epoch') <= maximumEpoch) {
      throw new KeyLifecycleError('epoch_not_monotonic', 'rotated key epoch must exceed every registered epoch');
    }
    if (decimal(nextInput.notBeforeEpochMs, 'notBeforeEpochMs') < effectiveAt) {
      throw new KeyLifecycleError('rotation_backdated', 'new key must not become valid before rotation time');
    }
    const next: KeyRecordV1 = { ...nextInput, revokedAtEpochMs: null };
    validateRecord(next);
    if (this.records.some((record) => record.keyId === next.keyId)) {
      throw new KeyLifecycleError('key_id_exists', 'key id already exists; key ids are never reused');
    }
    // Build the new state first and persist one atomic registry revision.
    const updated = this.records.map(cloneRecord);
    updated[previousIndex] = { ...previous, revokedAtEpochMs: effectiveAtEpochMs };
    updated.push(next);
    this.records = updated;
    this.persist();
  }

  public revoke(keyId: string, revokedAtEpochMs: string): void {
    const at = decimal(revokedAtEpochMs, 'revokedAtEpochMs');
    const index = this.records.findIndex((record) => record.keyId === keyId);
    if (index < 0) throw new KeyLifecycleError('key_not_found', 'key is not registered');
    const current = this.records[index]!;
    if (current.revokedAtEpochMs !== null) {
      if (current.revokedAtEpochMs === revokedAtEpochMs) return;
      throw new KeyLifecycleError('key_revoked', 'key was already revoked at a different time');
    }
    if (at < decimal(current.notBeforeEpochMs, 'notBeforeEpochMs')) {
      throw new KeyLifecycleError('invalid_revocation_time', 'revocation cannot precede key validity');
    }
    const updated = this.records.map(cloneRecord);
    updated[index] = { ...current, revokedAtEpochMs };
    this.records = updated;
    this.persist();
  }

  public resolveRecord(
    keyId: string,
    purpose: KelKeyPurposeV1,
    expectedEpoch: string,
    nowEpochMs: string,
  ): { readonly record: KeyRecordV1; readonly publicKey: KeyObject } {
    const now = decimal(nowEpochMs, 'nowEpochMs');
    const record = this.records.find((item) => item.keyId === keyId);
    if (!record) throw new KeyLifecycleError('unknown_key', 'key id is not registered');
    if (record.purpose !== purpose) throw new KeyLifecycleError('wrong_key_purpose', 'key purpose does not match operation');
    if (record.epoch !== expectedEpoch) throw new KeyLifecycleError('key_epoch_mismatch', 'key epoch does not match signed statement');
    if (record.revokedAtEpochMs !== null) throw new KeyLifecycleError('key_revoked', 'key is revoked');
    if (now < decimal(record.notBeforeEpochMs, 'notBeforeEpochMs')) {
      throw new KeyLifecycleError('key_not_yet_valid', 'key is not yet valid');
    }
    if (now >= decimal(record.notAfterEpochMs, 'notAfterEpochMs')) {
      throw new KeyLifecycleError('key_expired', 'key has expired');
    }
    return {
      record: cloneRecord(record),
      publicKey: createPublicKey({
        key: Buffer.from(record.publicKeySpkiBase64, 'base64'),
        format: 'der',
        type: 'spki',
      }),
    };
  }

  public resolve(
    keyId: string,
    purpose: KelKeyPurposeV1,
    expectedEpoch: string,
    nowEpochMs: string,
  ): KeyObject {
    return this.resolveRecord(keyId, purpose, expectedEpoch, nowEpochMs).publicKey;
  }

  public keyIds(purpose: KelKeyPurposeV1, nowEpochMs: string): readonly string[] {
    const now = decimal(nowEpochMs, 'nowEpochMs');
    return this.records
      .filter((record) => record.purpose === purpose &&
        record.revokedAtEpochMs === null &&
        now >= decimal(record.notBeforeEpochMs, 'notBeforeEpochMs') &&
        now < decimal(record.notAfterEpochMs, 'notAfterEpochMs'))
      .map((record) => record.keyId);
  }
}

export interface WitnessSignatureV1 {
  readonly witnessId: string;
  readonly keyId: string;
  readonly keyEpoch: string;
  readonly signatureBase64: string;
}
export interface WitnessStatementV1 {
  readonly schema: 'urn:klyn:witness-statement:v1';
  readonly witnessId: string;
  readonly ledgerId: string;
  readonly treeSize: string;
  readonly rootHash: string;
  readonly treeHeadDigest: string;
  readonly checkpointKeyEpoch: string;
  readonly issuedAtEpochMs: string;
}

export function createWitnessStatement(
  witnessId: string,
  checkpointEnvelope: DsseEnvelopeV1,
  treeHead: TreeHeadV1,
): WitnessStatementV1 {
  if (!witnessId) throw new TypeError('witnessId is required');
  validateDigest(treeHead.rootHash);
  return {
    schema: 'urn:klyn:witness-statement:v1',
    witnessId,
    ledgerId: treeHead.ledgerId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
    treeHeadDigest: digestJcs(checkpointEnvelope),
    checkpointKeyEpoch: treeHead.keyEpoch,
    issuedAtEpochMs: treeHead.issuedAtEpochMs,
  };
}

/** Runs inside an independent witness service, which holds its own private key. */
export function signWitnessStatement(
  statement: WitnessStatementV1,
  keyId: string,
  keyEpoch: string,
  privateKey: KeyObject,
): WitnessSignatureV1 {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('witness signing requires an Ed25519 private key');
  }
  const signatureBase64 = sign(
    null,
    Buffer.from(canonicalizeJcs(statement), 'utf8'),
    privateKey,
  ).toString('base64');
  return { witnessId: statement.witnessId, keyId, keyEpoch, signatureBase64 };
}

export interface WitnessQuorumOptions {
  /** Exactly three independently controlled witness identities. */
  readonly witnessIds: readonly [string, string, string];
  /** Defaults to 2-of-3. */
  readonly threshold?: number;
}
export interface WitnessRejectionV1 {
  readonly witnessId: string;
  readonly code: string;
}
export interface WitnessQuorumResultV1 {
  readonly accepted: boolean;
  readonly threshold: number;
  readonly validWitnessIds: readonly string[];
  readonly rejected: readonly WitnessRejectionV1[];
  readonly checkpointAuthentication: 'pass' | 'fail';
  readonly reasonCodes: readonly string[];
}

/**
 * Verifies the checkpoint with a currently valid checkpoint key and then validates
 * independent Ed25519 witness signatures. Duplicate or unconfigured witnesses never
 * increase the count. By design, key revocation is retroactive.
 */
export class WitnessQuorumVerifier {
  private readonly witnessIds: ReadonlySet<string>;
  private readonly threshold: number;

  public constructor(
    private readonly registry: KeyLifecycleRegistry,
    options: WitnessQuorumOptions,
  ) {
    const ids = options.witnessIds;
    if (ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => !id)) {
      throw new TypeError('witnessIds must contain exactly three distinct non-empty identities');
    }
    const threshold = options.threshold ?? 2;
    if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > 3) {
      throw new RangeError('witness threshold must be 2 or 3');
    }
    this.witnessIds = new Set(ids);
    this.threshold = threshold;
  }

  public verify(
    checkpointEnvelope: DsseEnvelopeV1,
    witnessSignatures: readonly WitnessSignatureV1[],
    nowEpochMs: string,
  ): WitnessQuorumResultV1 {
    const rejected: WitnessRejectionV1[] = [];
    const validWitnessIds: string[] = [];
    const reasonCodes: string[] = [];
    let head: TreeHeadV1;
    let checkpointAuthentication: 'pass' | 'fail' = 'fail';

    try {
      const payload = Buffer.from(checkpointEnvelope.payload, 'base64');
      if (payload.toString('base64') !== checkpointEnvelope.payload) {
        throw new KeyLifecycleError('invalid_checkpoint_payload', 'checkpoint payload is not canonical Base64');
      }
      const parsed = JSON.parse(payload.toString('utf8')) as TreeHeadV1;
      if (parsed.schema !== KEL_TREE_HEAD_SCHEMA ||
          !/^(0|[1-9][0-9]*)$/.test(parsed.keyEpoch) ||
          !/^(0|[1-9][0-9]*)$/.test(parsed.issuedAtEpochMs) ||
          !/^(0|[1-9][0-9]*)$/.test(parsed.treeSize)) {
        throw new KeyLifecycleError('invalid_checkpoint_payload', 'checkpoint metadata is invalid');
      }
      head = parsed;
      const checkpointKeys = new Map<string, KeyObject>();
      for (const signature of checkpointEnvelope.signatures) {
        try {
          checkpointKeys.set(
            signature.keyid,
            this.registry.resolve(signature.keyid, 'checkpoint', head.keyEpoch, nowEpochMs),
          );
        } catch (error) {
          rejected.push({
            witnessId: 'checkpoint:' + signature.keyid,
            code: error instanceof KeyLifecycleError ? error.code : 'checkpoint_key_invalid',
          });
        }
      }
      verifyDsseEnvelope(checkpointEnvelope, KEL_TREE_HEAD_PAYLOAD_TYPE, checkpointKeys);
      checkpointAuthentication = 'pass';
      validateDigest(head.rootHash);
    } catch {
      reasonCodes.push('checkpoint-authentication-failed');
      return {
        accepted: false,
        threshold: this.threshold,
        validWitnessIds,
        rejected,
        checkpointAuthentication,
        reasonCodes,
      };
    }

    const seen = new Set<string>();
    const digest = digestJcs(checkpointEnvelope);
    for (const signature of witnessSignatures) {
      if (!this.witnessIds.has(signature.witnessId)) {
        rejected.push({ witnessId: signature.witnessId, code: 'witness_not_configured' });
        continue;
      }
      if (seen.has(signature.witnessId)) {
        rejected.push({ witnessId: signature.witnessId, code: 'duplicate_witness' });
        continue;
      }
      seen.add(signature.witnessId);
      try {
        const resolved = this.registry.resolveRecord(
          signature.keyId, 'witness', signature.keyEpoch, nowEpochMs,
        );
        if (resolved.record.subjectId !== signature.witnessId) {
          throw new KeyLifecycleError('witness_identity_mismatch', 'witness key is registered to a different witness identity');
        }
        const key = resolved.publicKey;
        const statement: WitnessStatementV1 = {
          schema: 'urn:klyn:witness-statement:v1',
          witnessId: signature.witnessId,
          ledgerId: head.ledgerId,
          treeSize: head.treeSize,
          rootHash: head.rootHash,
          treeHeadDigest: digest,
          checkpointKeyEpoch: head.keyEpoch,
          issuedAtEpochMs: head.issuedAtEpochMs,
        };
        const signatureBytes = Buffer.from(signature.signatureBase64, 'base64');
        if (signatureBytes.length !== 64 ||
            signatureBytes.toString('base64') !== signature.signatureBase64 ||
            !verify(null, Buffer.from(canonicalizeJcs(statement), 'utf8'), key, signatureBytes)) {
          rejected.push({ witnessId: signature.witnessId, code: 'invalid_signature' });
          continue;
        }
        validWitnessIds.push(signature.witnessId);
      } catch (error) {
        rejected.push({
          witnessId: signature.witnessId,
          code: error instanceof KeyLifecycleError ? error.code : 'witness_key_invalid',
        });
      }
    }

    if (validWitnessIds.length < this.threshold) reasonCodes.push('witness_quorum_not_met');
    return {
      accepted: checkpointAuthentication === 'pass' && validWitnessIds.length >= this.threshold,
      threshold: this.threshold,
      validWitnessIds,
      rejected,
      checkpointAuthentication,
      reasonCodes,
    };
  }
}
