import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  KEL_TREE_HEAD_PAYLOAD_TYPE,
  KEL_TREE_HEAD_SCHEMA,
  canonicalizeJcs,
  dssePreAuthEncoding,
  type DsseEnvelopeV1,
  type TreeHeadV1,
} from '../src/kel.js';
import {
  InMemoryKeyRegistryStorage,
  JsonFileKeyRegistryStorage,
  KeyLifecycleError,
  KeyLifecycleRegistry,
  WitnessQuorumVerifier,
  createWitnessStatement,
  signWitnessStatement,
  type RegisterKeyInputV1,
} from '../src/witness.js';

const NOW = '1000';
const EXPIRY = '100000';
function publicKeySpkiBase64(pair: ReturnType<typeof generateKeyPairSync>) {
  return pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}
function signEnvelope(head: TreeHeadV1, keyId: string, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): DsseEnvelopeV1 {
  const payload = Buffer.from(canonicalizeJcs(head), 'utf8');
  const pae = Buffer.from(dssePreAuthEncoding(KEL_TREE_HEAD_PAYLOAD_TYPE, payload));
  return {
    payloadType: KEL_TREE_HEAD_PAYLOAD_TYPE,
    payload: payload.toString('base64'),
    signatures: [{ keyid: keyId, sig: sign(null, pae, privateKey).toString('base64') }],
  };
}
function registerKey(
  registry: KeyLifecycleRegistry,
  keyId: string,
  subjectId: string,
  purpose: 'checkpoint' | 'witness',
  pair: ReturnType<typeof generateKeyPairSync>,
  epoch = '1',
  notAfterEpochMs = EXPIRY,
): void {
  const input: RegisterKeyInputV1 = {
    keyId,
    subjectId,
    purpose,
    epoch,
    publicKeySpkiBase64: publicKeySpkiBase64(pair),
    notBeforeEpochMs: '0',
    notAfterEpochMs,
  };
  registry.register(input);
}

test('2-of-3 independent witness signatures validate a checkpoint', () => {
  const registry = new KeyLifecycleRegistry(new InMemoryKeyRegistryStorage());
  const checkpoint = generateKeyPairSync('ed25519');
  registerKey(registry, 'checkpoint-1', 'ledger-checkpoint', 'checkpoint', checkpoint);
  const witnessPairs = [generateKeyPairSync('ed25519'), generateKeyPairSync('ed25519'), generateKeyPairSync('ed25519')];
  witnessPairs.forEach((pair, index) => registerKey(registry, 'witness-key-' + index, 'w' + index, 'witness', pair));

  const head: TreeHeadV1 = {
    schema: KEL_TREE_HEAD_SCHEMA,
    ledgerId: 'ledger-test',
    hashAlgorithm: 'sha256',
    treeAlgorithm: 'rfc9162-sha256',
    treeSize: '7',
    rootHash: 'sha256:' + 'ab'.repeat(32),
    previousCheckpointDigest: null,
    keyEpoch: '1',
    issuedAtEpochMs: '900',
  };
  const envelope = signEnvelope(head, 'checkpoint-1', checkpoint.privateKey);
  const signatures = [0, 1].map((index) => {
    const statement = createWitnessStatement('w' + index, envelope, head);
    return signWitnessStatement(statement, 'witness-key-' + index, '1', witnessPairs[index]!.privateKey);
  });
  const verifier = new WitnessQuorumVerifier(registry, { witnessIds: ['w0', 'w1', 'w2'], threshold: 2 });
  const result = verifier.verify(envelope, signatures, NOW);
  assert.equal(result.accepted, true);
  assert.equal(result.validWitnessIds.length, 2);
  assert.equal(result.checkpointAuthentication, 'pass');
});

test('duplicate witness ids never satisfy quorum twice', () => {
  const registry = new KeyLifecycleRegistry(new InMemoryKeyRegistryStorage());
  const checkpoint = generateKeyPairSync('ed25519');
  registerKey(registry, 'cp', 'ledger', 'checkpoint', checkpoint);
  const witness = generateKeyPairSync('ed25519');
  registerKey(registry, 'wk0', 'w0', 'witness', witness);
  const head: TreeHeadV1 = {
    schema: KEL_TREE_HEAD_SCHEMA, ledgerId: 'L', hashAlgorithm: 'sha256',
    treeAlgorithm: 'rfc9162-sha256', treeSize: '1', rootHash: 'sha256:' + '11'.repeat(32),
    previousCheckpointDigest: null, keyEpoch: '1', issuedAtEpochMs: '900',
  };
  const envelope = signEnvelope(head, 'cp', checkpoint.privateKey);
  const statement = createWitnessStatement('w0', envelope, head);
  const sig = signWitnessStatement(statement, 'wk0', '1', witness.privateKey);
  const verifier = new WitnessQuorumVerifier(registry, { witnessIds: ['w0', 'w1', 'w2'] });
  const result = verifier.verify(envelope, [sig, sig], NOW);
  assert.equal(result.accepted, false);
  assert.equal(result.validWitnessIds.length, 1);
  assert.ok(result.rejected.some((item) => item.code === 'duplicate_witness'));
});

test('revoked and expired keys are rejected, and rotation advances the epoch', () => {
  const registry = new KeyLifecycleRegistry(new InMemoryKeyRegistryStorage());
  const first = generateKeyPairSync('ed25519');
  registerKey(registry, 'witness-epoch-1', 'witness-a', 'witness', first, '1', '2000');
  const second = generateKeyPairSync('ed25519');
  registry.rotate('witness-epoch-1', {
    keyId: 'witness-epoch-2', subjectId: 'witness-a', purpose: 'witness', epoch: '2',
    publicKeySpkiBase64: publicKeySpkiBase64(second),
    notBeforeEpochMs: '1500', notAfterEpochMs: '3000',
  }, '1500');
  assert.throws(
    () => registry.resolve('witness-epoch-1', 'witness', '1', '1600'),
    (error: unknown) => error instanceof KeyLifecycleError && error.code === 'key_revoked',
  );
  assert.throws(
    () => registry.resolve('witness-epoch-2', 'witness', '1', '1600'),
    (error: unknown) => error instanceof KeyLifecycleError && error.code === 'key_epoch_mismatch',
  );
  assert.throws(
    () => registry.resolve('witness-epoch-2', 'witness', '2', '3000'),
    (error: unknown) => error instanceof KeyLifecycleError && error.code === 'key_expired',
  );
  assert.equal(registry.resolve('witness-epoch-2', 'witness', '2', '1600').type, 'public');
});

test('registry never reuses key IDs or epochs and persists the new revision', () => {
  const storage = new InMemoryKeyRegistryStorage();
  const registry = new KeyLifecycleRegistry(storage);
  const pair = generateKeyPairSync('ed25519');
  registerKey(registry, 'id-1', 'producer-a', 'witness', pair);
  assert.throws(() => registerKey(registry, 'id-1', 'producer-a', 'witness', pair));
  assert.equal(storage.load()?.records.length, 1);
  assert.ok(BigInt(registry.snapshot().revision) >= 2n);
});

test('file registry persists across instances with restrictive file permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kel-key-registry-'));
  const registryPath = join(directory, 'keys.json');
  try {
    const pair = generateKeyPairSync('ed25519');
    const storage = new JsonFileKeyRegistryStorage(registryPath);
    const first = new KeyLifecycleRegistry(storage);
    registerKey(first, 'persisted-key', 'producer-1', 'witness', pair);
    assert.equal(statSync(registryPath).mode & 0o777, 0o600);
    const second = new KeyLifecycleRegistry(new JsonFileKeyRegistryStorage(registryPath));
    assert.deepEqual(second.keyIds('witness', NOW), ['persisted-key']);
    assert.equal(second.snapshot().records.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
