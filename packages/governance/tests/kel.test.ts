import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  canonicalizeJcs,
  digestJcs,
  merkleLeafHash,
  merkleRoot,
  createInclusionProof,
  verifyInclusionProof,
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
