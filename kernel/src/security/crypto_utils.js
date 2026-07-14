/**
 * =============================================================================
 * KLYN AI OS — Kernel Cryptographic Utilities
 * File: kernel/src/security/crypto_utils.js
 * Version: 1.0.0
 * Phase: 1.1 — Cryptographic Foundation (Isolation)
 * =============================================================================
 *
 * SECURITY BOUNDARY CONTRACT:
 *   - This module is KERNEL-LAYER ONLY. It must never be imported by agent
 *     code, shared utilities, or application layer modules.
 *   - All functions operate exclusively on Node.js built-in 'crypto' module.
 *     No third-party cryptographic dependencies are permitted. Third-party
 *     dependencies introduce supply-chain attack surface.
 *   - Key material (raw Buffer output from randomBytes) is never logged,
 *     never serialized, and never placed in process.env.
 *   - All HMAC operations use SHA-256 minimum. MD5 and SHA-1 are not used.
 *   - Timing-safe comparison is used for all MAC verification to prevent
 *     timing side-channel attacks.
 *
 * WHAT THIS MODULE PROVIDES:
 *   - Secure random key and ID generation.
 *   - HMAC-SHA256 signing and verification for IPC messages.
 *   - AES-256-GCM symmetric encryption/decryption for vault-at-rest storage.
 *   - Payload hashing (SHA-256) for integrity verification.
 *   - Token derivation (HKDF) for producing scoped sub-keys from a master key.
 *
 * WHAT THIS MODULE DOES NOT PROVIDE:
 *   - Asymmetric cryptography (not needed for IPC; adds latency on Termux).
 *   - Key storage (that is the vault's responsibility).
 *   - Token business logic (that is the vault's responsibility).
 * =============================================================================
 */

'use strict';

const crypto = require('crypto');

// =============================================================================
// SECTION 1: CONSTANTS
// =============================================================================

const ALGORITHM_SYMMETRIC = 'aes-256-gcm';
const ALGORITHM_HMAC      = 'sha256';
const ALGORITHM_HASH      = 'sha256';
const ALGORITHM_HKDF      = 'sha256';

const KEY_LENGTH_BYTES    = 32;    // 256 bits for AES-256 and HMAC-SHA256.
const IV_LENGTH_BYTES     = 12;    // 96 bits — GCM recommended IV length.
const GCM_AUTH_TAG_BYTES  = 16;    // 128-bit authentication tag.
const SESSION_KEY_BYTES   = 32;    // Per-session HMAC key length.
const SALT_LENGTH_BYTES   = 32;    // HKDF salt length.
const CORRELATION_BYTES   = 8;     // 64-bit correlation IDs.

// =============================================================================
// SECTION 2: RANDOM GENERATION
// =============================================================================

/**
 * Generates cryptographically secure random bytes.
 * Wraps crypto.randomBytes with a descriptive error on failure.
 *
 * @param {number} length  Number of bytes to generate.
 * @returns {Buffer}
 * @throws {Error}  If the entropy source is unavailable.
 */
function generateSecureBytes(length) {
  if (!Number.isInteger(length) || length <= 0 || length > 65536) {
    throw new RangeError(`generateSecureBytes: invalid length ${length}.`);
  }
  try {
    return crypto.randomBytes(length);
  } catch (err) {
    // crypto.randomBytes can fail if the OS entropy pool is exhausted.
    // This is extremely rare but must be handled, especially on Android.
    throw new Error(
      `KLYN FATAL: Entropy source unavailable. Cannot generate secure bytes. ` +
      `Original: ${err.message}`
    );
  }
}

/**
 * Generates a new per-session HMAC key for IPC message signing.
 * Each agent session receives a unique key established during the handshake.
 *
 * @returns {Buffer}  32-byte (256-bit) key buffer.
 */
function generateSessionKey() {
  return generateSecureBytes(SESSION_KEY_BYTES);
}

/**
 * Generates a URL-safe, hex-encoded unique identifier.
 * Used for correlation IDs, nonces, and request tracking.
 *
 * @param {number} [byteLength=8]  Number of random bytes (hex string is 2x longer).
 * @returns {string}  Hex string, e.g. "a3f1e29d4b7c8e0f".
 */
function generateId(byteLength = CORRELATION_BYTES) {
  return generateSecureBytes(byteLength).toString('hex');
}

/**
 * Generates a master vault key for AES-256-GCM encryption.
 * This key should be generated once, stored securely, and never regenerated
 * unless rotating the vault's encryption key.
 *
 * @returns {Buffer}  32-byte key buffer.
 */
function generateVaultKey() {
  return generateSecureBytes(KEY_LENGTH_BYTES);
}

// =============================================================================
// SECTION 3: HMAC SIGNING AND VERIFICATION
// =============================================================================

/**
 * Computes an HMAC-SHA256 signature over a canonical message representation.
 *
 * The message is canonicalized before signing to prevent ambiguity:
 * fields are sorted alphabetically and serialized to JSON. This ensures
 * that two objects with identical content but different key ordering
 * produce identical signatures.
 *
 * @param {object|string} payload   The data to sign.
 * @param {Buffer|string} key       The HMAC key (Buffer preferred).
 * @returns {string}                Hex-encoded HMAC-SHA256 digest.
 * @throws {TypeError}              If key is missing or payload is invalid.
 */
function signPayload(payload, key) {
  _assertKey(key, 'signPayload');
  const canonical = _canonicalize(payload);
  return crypto
    .createHmac(ALGORITHM_HMAC, key)
    .update(canonical, 'utf8')
    .digest('hex');
}

/**
 * Verifies an HMAC-SHA256 signature using a timing-safe comparison.
 *
 * The timing-safe comparison (crypto.timingSafeEqual) prevents attackers
 * from deducing valid signature characters by measuring response time
 * differences. This is required for any MAC verification in a system that
 * handles external input.
 *
 * @param {object|string} payload    The data that was signed.
 * @param {string}        signature  The hex-encoded signature to verify.
 * @param {Buffer|string} key        The HMAC key.
 * @returns {boolean}                True if the signature is valid.
 */
function verifyPayload(payload, signature, key) {
  _assertKey(key, 'verifyPayload');
  if (typeof signature !== 'string' || signature.length === 0) {
    return false;
  }

  try {
    const expected = signPayload(payload, key);
    const expectedBuf  = Buffer.from(expected,  'hex');
    const receivedBuf  = Buffer.from(signature, 'hex');

    // Buffers must be the same length for timingSafeEqual.
    // Length mismatch is itself a verification failure.
    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch (_) {
    // Any error during verification (e.g., malformed hex) is a failure.
    return false;
  }
}

// =============================================================================
// SECTION 4: PAYLOAD HASHING
// =============================================================================

/**
 * Computes a SHA-256 hash of a payload for integrity verification.
 * This is used to produce the payload digest embedded in IPC message headers.
 *
 * @param {object|string|Buffer} payload
 * @returns {string}  Hex-encoded SHA-256 digest.
 */
function hashPayload(payload) {
  let input;
  if (Buffer.isBuffer(payload)) {
    input = payload;
  } else if (typeof payload === 'string') {
    input = Buffer.from(payload, 'utf8');
  } else {
    input = Buffer.from(_canonicalize(payload), 'utf8');
  }
  return crypto.createHash(ALGORITHM_HASH).update(input).digest('hex');
}

// =============================================================================
// SECTION 5: AES-256-GCM SYMMETRIC ENCRYPTION
// =============================================================================

/**
 * Encrypts plaintext using AES-256-GCM.
 *
 * AES-256-GCM provides both confidentiality (encryption) and integrity
 * (authentication tag). The authentication tag is mandatory and will cause
 * decryption to fail if the ciphertext has been tampered with.
 *
 * Output format (all concatenated into a single Buffer):
 *   [ IV (12 bytes) ][ AuthTag (16 bytes) ][ Ciphertext (variable) ]
 *
 * @param {string|Buffer} plaintext     Data to encrypt.
 * @param {Buffer}        key           32-byte AES key.
 * @param {string}        [aad='']      Additional authenticated data (not encrypted).
 * @returns {Buffer}                    Encrypted blob (IV + AuthTag + Ciphertext).
 * @throws {Error}                      On invalid key length or encryption failure.
 */
function encrypt(plaintext, key, aad = '') {
  _assertKey(key, 'encrypt');
  _assertKeyLength(key, KEY_LENGTH_BYTES, 'encrypt');

  const iv          = generateSecureBytes(IV_LENGTH_BYTES);
  const inputBuffer = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext, 'utf8');

  const cipher = crypto.createCipheriv(ALGORITHM_SYMMETRIC, key, iv);

  if (aad) {
    cipher.setAAD(Buffer.from(aad, 'utf8'), { plaintextLength: inputBuffer.length });
  }

  const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  // Pack: [IV][AuthTag][Ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts an AES-256-GCM encrypted blob produced by encrypt().
 *
 * @param {Buffer} encryptedBlob   The full encrypted blob (IV + AuthTag + Ciphertext).
 * @param {Buffer} key             32-byte AES key.
 * @param {string} [aad='']       Additional authenticated data (must match encryption).
 * @returns {Buffer}               Decrypted plaintext as a Buffer.
 * @throws {Error}                 On authentication failure or decryption error.
 */
function decrypt(encryptedBlob, key, aad = '') {
  _assertKey(key, 'decrypt');
  _assertKeyLength(key, KEY_LENGTH_BYTES, 'decrypt');

  const minLength = IV_LENGTH_BYTES + GCM_AUTH_TAG_BYTES + 1;
  if (!Buffer.isBuffer(encryptedBlob) || encryptedBlob.length < minLength) {
    throw new Error(
      `decrypt: encrypted blob is too short to be valid. ` +
      `Minimum length: ${minLength}, received: ${encryptedBlob?.length ?? 0}.`
    );
  }

  // Unpack: [IV][AuthTag][Ciphertext]
  const iv         = encryptedBlob.subarray(0, IV_LENGTH_BYTES);
  const authTag    = encryptedBlob.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + GCM_AUTH_TAG_BYTES);
  const ciphertext = encryptedBlob.subarray(IV_LENGTH_BYTES + GCM_AUTH_TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM_SYMMETRIC, key, iv);
  decipher.setAuthTag(authTag);

  if (aad) {
    decipher.setAAD(Buffer.from(aad, 'utf8'), { plaintextLength: ciphertext.length });
  }

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    // Re-throw with a sanitized message. Do not leak internal error details.
    throw new Error(
      'decrypt: Authentication failed. The ciphertext may have been tampered with, ' +
      'or the key or AAD is incorrect.'
    );
  }
}

// =============================================================================
// SECTION 6: KEY DERIVATION (HKDF)
// =============================================================================

/**
 * Derives a scoped sub-key from a master key using HKDF-SHA256.
 *
 * HKDF (HMAC-based Key Derivation Function, RFC 5869) produces a
 * cryptographically independent sub-key for a specific purpose (the 'info'
 * parameter) from a master key. This allows one master key to safely
 * produce multiple independent sub-keys — one per agent, one per operation
 * class — without compromising the master key.
 *
 * @param {Buffer} masterKey        The master key material (min 32 bytes).
 * @param {string} info             Contextual binding (e.g., "agent:bug_hunter:IPC").
 * @param {number} [keyLength=32]   Output key length in bytes.
 * @returns {Buffer}                Derived key buffer.
 * @throws {Error}                  On invalid input or derivation failure.
 */
function deriveKey(masterKey, info, keyLength = KEY_LENGTH_BYTES) {
  _assertKey(masterKey, 'deriveKey');
  if (typeof info !== 'string' || info.trim().length === 0) {
    throw new TypeError('deriveKey: info must be a non-empty string.');
  }
  if (!Number.isInteger(keyLength) || keyLength < 1 || keyLength > 255 * 32) {
    throw new RangeError(`deriveKey: invalid keyLength ${keyLength}.`);
  }

  const salt = generateSecureBytes(SALT_LENGTH_BYTES);

  return new Promise((resolve, reject) => {
    crypto.hkdf(
      ALGORITHM_HKDF,
      masterKey,
      salt,
      Buffer.from(info, 'utf8'),
      keyLength,
      (err, derivedKey) => {
        if (err) reject(new Error(`deriveKey: HKDF failed. ${err.message}`));
        else     resolve(Buffer.from(derivedKey));
      }
    );
  });
}

/**
 * Synchronous HKDF key derivation using the manual expand step.
 * Used in paths where async is not permitted (e.g., vault initialization).
 * Uses a fixed zero-salt for the extract step when a deterministic sub-key
 * is required (the master key already contains sufficient entropy).
 *
 * @param {Buffer} masterKey
 * @param {string} info
 * @param {number} [keyLength=32]
 * @returns {Buffer}
 */
function deriveKeySync(masterKey, info, keyLength = KEY_LENGTH_BYTES) {
  _assertKey(masterKey, 'deriveKeySync');
  if (typeof info !== 'string' || info.trim().length === 0) {
    throw new TypeError('deriveKeySync: info must be a non-empty string.');
  }

  // Manual HKDF-Extract: PRK = HMAC-SHA256(salt=zeros, IKM=masterKey)
  const zerSalt = Buffer.alloc(32, 0);
  const prk = crypto.createHmac(ALGORITHM_HMAC, zerSalt).update(masterKey).digest();

  // Manual HKDF-Expand: T(1) = HMAC-SHA256(PRK, info || 0x01)
  const infoBuffer = Buffer.from(info, 'utf8');
  const counter    = Buffer.from([0x01]);
  const t1 = crypto
    .createHmac(ALGORITHM_HMAC, prk)
    .update(infoBuffer)
    .update(counter)
    .digest();

  return t1.subarray(0, keyLength);
}

// =============================================================================
// SECTION 7: PRIVATE VALIDATION HELPERS
// =============================================================================

/**
 * Asserts that a key argument is a non-empty Buffer or string.
 * @param {*}      key
 * @param {string} callerName
 */
function _assertKey(key, callerName) {
  if (Buffer.isBuffer(key)) {
    if (key.length === 0) {
      throw new TypeError(`${callerName}: key Buffer must not be empty.`);
    }
    return;
  }
  if (typeof key === 'string') {
    if (key.length === 0) {
      throw new TypeError(`${callerName}: key string must not be empty.`);
    }
    return;
  }
  throw new TypeError(
    `${callerName}: key must be a Buffer or string, received ${typeof key}.`
  );
}

/**
 * Asserts that a Buffer key has the required byte length.
 * @param {Buffer} key
 * @param {number} expectedLength
 * @param {string} callerName
 */
function _assertKeyLength(key, expectedLength, callerName) {
  if (Buffer.isBuffer(key) && key.length !== expectedLength) {
    throw new Error(
      `${callerName}: key must be exactly ${expectedLength} bytes, ` +
      `received ${key.length} bytes.`
    );
  }
}

/**
 * Produces a canonical, deterministic JSON string from an object or string.
 * Keys are sorted alphabetically to ensure consistent serialization order.
 *
 * @param {object|string} payload
 * @returns {string}
 */
function _canonicalize(payload) {
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null) {
    return JSON.stringify(payload, Object.keys(payload).sort());
  }
  return String(payload);
}

// =============================================================================
// SECTION 8: EXPORTS
// =============================================================================

module.exports = Object.freeze({
  // Random generation
  generateSecureBytes,
  generateSessionKey,
  generateId,
  generateVaultKey,

  // HMAC signing / verification
  signPayload,
  verifyPayload,

  // Hashing
  hashPayload,

  // AES-256-GCM encryption / decryption
  encrypt,
  decrypt,

  // Key derivation
  deriveKey,
  deriveKeySync,

  // Expose constants for dependent modules (vault, IPC mailbox).
  CONSTANTS: Object.freeze({
    KEY_LENGTH_BYTES,
    IV_LENGTH_BYTES,
    GCM_AUTH_TAG_BYTES,
    SESSION_KEY_BYTES,
    SALT_LENGTH_BYTES,
  }),
});
