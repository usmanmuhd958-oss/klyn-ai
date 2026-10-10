import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { canonicalize, digestJson, sha256, signEd25519, verifyEd25519 } from '../src/crypto.js';

test('canonicalize sorts keys recursively and omits undefined object properties', () => {
  assert.equal(
    canonicalize({ z: undefined, b: { y: undefined, x: 1 }, a: null }),
    '{"a":null,"b":{"x":1}}',
  );
  assert.equal(canonicalize(undefined), 'null');
  assert.equal(canonicalize([undefined, null]), '[null,null]');
});

test('digestJson is stable for equivalent objects with different insertion order', () => {
  assert.equal(digestJson({ b: 2, a: 1 }), digestJson({ a: 1, b: 2 }));
});

test('sha256 hashes strings and byte arrays directly, and canonicalizes other values', () => {
  assert.equal(sha256('hello'), createHash('sha256').update('hello').digest('hex'));
  assert.equal(sha256(new TextEncoder().encode('hello')), sha256('hello'));
  assert.equal(sha256({ b: 2, a: 1 }), sha256('{"a":1,"b":2}'));
});

test('Ed25519 raw hex keys produce and verify RFC 8032 signatures', () => {
  const privateKeyHex = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
  const publicKeyHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
  const expectedSignatureHex =
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
    '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

  const signatureHex = signEd25519('', privateKeyHex);
  assert.equal(signatureHex, expectedSignatureHex);
  assert.equal(verifyEd25519(signatureHex, '', publicKeyHex), true);
  assert.equal(verifyEd25519(signatureHex, 'tampered', publicKeyHex), false);
  assert.equal(verifyEd25519('not-hex', '', publicKeyHex), false);
});
