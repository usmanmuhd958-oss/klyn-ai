import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import type { JsonValue } from './types.js';
import { isJsonValue } from './validation.js';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_SEED_BYTES = 32;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

function compareKeys(left: string, right: string): number {
  // String comparison is locale-independent, which keeps hashes stable across hosts.
  return left < right ? -1 : left > right ? 1 : 0;
}

function serializeCanonical(value: unknown, ancestors: Set<object>, inArray: boolean): string | undefined {
  if (value === undefined) return inArray ? 'null' : undefined;
  if (value === null) return 'null';

  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number is not canonicalizable');
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new TypeError(`value of type ${typeof value} is not canonicalizable`);
  }

  if (ancestors.has(value)) throw new TypeError('cyclic value is not canonicalizable');
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      // Array.from also turns sparse slots into undefined; those serialize as null.
      const entries = Array.from(value, (entry) => serializeCanonical(entry, ancestors, true) ?? 'null');
      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('only plain objects are canonicalizable');
    }

    const record = value as Record<string, unknown>;
    const entries: string[] = [];
    for (const key of Object.keys(record).sort(compareKeys)) {
      const serialized = serializeCanonical(record[key], ancestors, false);
      // JSON object properties with undefined values are omitted rather than hashed.
      if (serialized !== undefined) entries.push(`${JSON.stringify(key)}:${serialized}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Deterministically serializes JSON-like data. Object keys are sorted recursively;
 * undefined object properties are omitted and a root undefined value becomes null.
 */
export function canonicalize(obj: unknown): string {
  return serializeCanonical(obj, new Set<object>(), false) ?? 'null';
}

/**
 * Hash strings and byte arrays as-is. Other values are canonicalized first.
 */
export function sha256(data: unknown): string {
  if (typeof data === 'string') {
    return createHash('sha256').update(data, 'utf8').digest('hex');
  }
  if (data instanceof Uint8Array) {
    return createHash('sha256').update(data).digest('hex');
  }
  return createHash('sha256').update(canonicalize(data), 'utf8').digest('hex');
}

export function digestJson(obj: unknown): string {
  return sha256(canonicalize(obj));
}

function decodeHex(value: string, label: string): Buffer {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) {
    throw new TypeError(`${label} must be a non-empty hexadecimal string`);
  }
  return Buffer.from(hex, 'hex');
}

function privateKeyFromHex(privateKeyHex: string): KeyObject {
  const encoded = decodeHex(privateKeyHex, 'privateKeyHex');
  let key: KeyObject;

  if (encoded.length === ED25519_SEED_BYTES) {
    // Node accepts Ed25519 private keys as PKCS#8; wrap the raw 32-byte seed.
    key = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, encoded]),
      format: 'der',
      type: 'pkcs8',
    });
  } else if (encoded.length === ED25519_SEED_BYTES * 2) {
    // Also accept the 64-byte seed || public-key form used by some Ed25519 toolkits.
    key = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, encoded.subarray(0, ED25519_SEED_BYTES)]),
      format: 'der',
      type: 'pkcs8',
    });
    const derivedPublicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-ED25519_PUBLIC_KEY_BYTES);
    if (!derivedPublicKey.equals(encoded.subarray(ED25519_SEED_BYTES))) {
      throw new TypeError('privateKeyHex contains a public-key suffix that does not match its seed');
    }
  } else {
    // A PKCS#8 DER key encoded as hex is accepted for direct Node.js interoperability.
    key = createPrivateKey({ key: encoded, format: 'der', type: 'pkcs8' });
  }

  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'private') {
    throw new TypeError('privateKeyHex must encode an Ed25519 private key');
  }
  return key;
}

function publicKeyFromHex(publicKeyHex: string): KeyObject {
  const encoded = decodeHex(publicKeyHex, 'publicKeyHex');
  const key = encoded.length === ED25519_PUBLIC_KEY_BYTES
    ? createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, encoded]),
        format: 'der',
        type: 'spki',
      })
    : createPublicKey({ key: encoded, format: 'der', type: 'spki' });

  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') {
    throw new TypeError('publicKeyHex must encode an Ed25519 public key');
  }
  return key;
}

/**
 * Signs a UTF-8 message with a raw Ed25519 private-key hex string and returns
 * the 64-byte signature as hex. The KeyObject overload preserves the legacy
 * Base64 format used by existing governance attestations.
 */
export function signEd25519(message: string, privateKeyHex: string): string;
export function signEd25519(message: string, privateKey: KeyObject): string;
export function signEd25519(message: string, privateKeyHexOrKey: string | KeyObject): string {
  if (typeof privateKeyHexOrKey === 'string') {
    const key = privateKeyFromHex(privateKeyHexOrKey);
    return sign(null, Buffer.from(message, 'utf8'), key).toString('hex');
  }

  if (privateKeyHexOrKey.asymmetricKeyType !== 'ed25519' || privateKeyHexOrKey.type !== 'private') {
    throw new TypeError('privateKey must be an Ed25519 private key');
  }
  return sign(null, Buffer.from(message, 'utf8'), privateKeyHexOrKey).toString('base64');
}

/**
 * Verifies signatureHex(message, publicKeyHex). For backwards compatibility,
 * (message, signatureBase64, KeyObject) continues to verify legacy attestations.
 */
export function verifyEd25519(signatureHex: string, message: string, publicKeyHex: string): boolean;
export function verifyEd25519(message: string, signatureBase64: string, publicKey: KeyObject): boolean;
export function verifyEd25519(
  first: string,
  second: string,
  publicKeyHexOrKey: string | KeyObject,
): boolean {
  try {
    if (typeof publicKeyHexOrKey === 'string') {
      const signature = decodeHex(first, 'signatureHex');
      if (signature.length !== ED25519_SIGNATURE_BYTES) return false;
      const key = publicKeyFromHex(publicKeyHexOrKey);
      return verify(null, Buffer.from(second, 'utf8'), key, signature);
    }

    if (publicKeyHexOrKey.asymmetricKeyType !== 'ed25519' || publicKeyHexOrKey.type !== 'public') {
      return false;
    }
    return verify(
      null,
      Buffer.from(first, 'utf8'),
      publicKeyHexOrKey,
      Buffer.from(second, 'base64'),
    );
  } catch {
    return false;
  }
}

export function assertCanonicalizable(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) throw new Error('value is not valid JSON data');
  canonicalize(value);
}
