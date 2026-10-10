import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { signEd25519 } from '../src/crypto.js';
import {
  canonicalizeJcs,
  digestJcs,
  merkleLeafHash,
  merkleRoot,
  createInclusionProof,
  verifyInclusionProof,
  createConsistencyProof,
  verifyConsistencyProof,
  dssePreAuthEncoding,
  verifyDsseEnvelope,
  KEL_EVIDENCE_PAYLOAD_TYPE,
} from '../src/kel.js';

test('KEL JCS rejects undefined and non-finite numbers rather than silently omitting fields', () => {
  assert.equal(canonicalizeJcs({ z: 1, a: 2 }), '{"a":2,"z":1}');
  assert.throws(() => canonicalizeJcs({ value: undefined }), /undefined/);
  assert.throws(() => canonicalizeJcs(Number.NaN), /non-finite/);
  assert.throws(() => canonicalizeJcs('\ud800'), /surrogate/);
});

test('KEL JCS digest is stable across object insertion order', () => {
  assert.equal(digestJcs({ b: 2, a: 1 }), digestJcs({ a: 1, b: 2 }));
});

test('RFC 9162 Merkle inclusion proofs verify for irregular tree sizes', () => {
  for (let size = 1; size < 20; size += 1) {
    const hashes = Array.from({ length: size }, (_, index) =>
      merkleLeafHash(Buffer.from(String(index), 'utf8')),
    );
    const root = Buffer.from(merkleRoot(hashes)).toString('hex');
    for (let index = 0; index < size; index += 1) {
      const proof = createInclusionProof(hashes, index);
      assert.equal(verifyInclusionProof(hashes[index]!, index, size, proof, root), true);
      assert.equal(verifyInclusionProof(hashes[index]!, index, size, proof, '00'.repeat(32)), false);
    }
  }
});


test('RFC 9162 consistency proofs verify every non-empty prefix', () => {
  for (let newSize = 2; newSize < 25; newSize += 1) {
    const hashes = Array.from({ length: newSize }, (_, index) =>
      merkleLeafHash(Buffer.from(String(index), 'utf8')),
    );
    const newRoot = Buffer.from(merkleRoot(hashes)).toString('hex');
    for (let oldSize = 1; oldSize < newSize; oldSize += 1) {
      const oldRoot = Buffer.from(merkleRoot(hashes.slice(0, oldSize))).toString('hex');
      const proof = createConsistencyProof(hashes, oldSize);
      assert.equal(verifyConsistencyProof(oldSize, newSize, oldRoot, newRoot, proof), true,
        `old=${oldSize}, new=${newSize}`);
      assert.equal(verifyConsistencyProof(oldSize, newSize, oldRoot, '00'.repeat(32), proof), false);
    }
  }
});


test('DSSE v1 PAE binds payload type and verifies a trusted Ed25519 signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from(canonicalizeJcs({ evidenceId: 'e-1', schema: 'urn:klyn:evidence:v1' }), 'utf8');
  const pae = dssePreAuthEncoding(KEL_EVIDENCE_PAYLOAD_TYPE, payload);
  const envelope = {
    payloadType: KEL_EVIDENCE_PAYLOAD_TYPE,
    payload: payload.toString('base64'),
    signatures: [{
      keyid: 'test-key',
      sig: signEd25519(pae.toString('utf8'), privateKey),
    }],
  };
  const decoded = verifyDsseEnvelope(envelope, KEL_EVIDENCE_PAYLOAD_TYPE, new Map([['test-key', publicKey]]));
  assert.deepEqual(decoded, { evidenceId: 'e-1', schema: 'urn:klyn:evidence:v1' });
  assert.throws(() => verifyDsseEnvelope(envelope, 'application/other', new Map([['test-key', publicKey]])));
});
