/**
 * KLYN AI OS — Cryptographic Utilities
 * Provides HMAC-SHA256 token generation and constant-time verification.
 * Used by both the Kernel and all Agent processes.
 */

"use strict";

const crypto = require("crypto");

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM      = "sha256";
const TOKEN_ENCODING = "hex";
const TOKEN_TTL_MS   = 30_000; // 30 seconds — tokens are short-lived by design

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives a deterministic HMAC signature over a payload using the master secret.
 *
 * @param {string} payload   - Canonical string to sign (agentId + ":" + issuedAt)
 * @param {string} secret    - Master secret (never transmitted; only the token leaves this fn)
 * @returns {string}         - Hex-encoded HMAC digest
 */
function deriveHMAC(payload, secret) {
  if (typeof payload !== "string" || typeof secret !== "string") {
    throw new TypeError("[crypto_utils] deriveHMAC: payload and secret must be strings");
  }

  return crypto
    .createHmac(ALGORITHM, secret)
    .update(payload)
    .digest(TOKEN_ENCODING);
}

/**
 * Issues a time-bound token for a given agent.
 *
 * Token format (base64url-encoded JSON envelope):
 *   { agentId, issuedAt, signature }
 *
 * @param {string} agentId  - Unique agent identifier
 * @param {string} secret   - Master secret from environment
 * @returns {string}        - Opaque base64url token string
 */
function issueToken(agentId, secret) {
  if (!agentId || typeof agentId !== "string") {
    throw new TypeError("[crypto_utils] issueToken: agentId must be a non-empty string");
  }

  const issuedAt = Date.now();
  const payload  = `${agentId}:${issuedAt}`;
  const signature = deriveHMAC(payload, secret);

  const envelope = { agentId, issuedAt, signature };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

/**
 * Verifies a token. Returns a result object — never throws on invalid tokens
 * so callers can handle gracefully without try/catch clutter.
 *
 * @param {string} rawToken  - The opaque token string received from an agent
 * @param {string} agentId   - Expected agentId (must match token's embedded agentId)
 * @param {string} secret    - Master secret for HMAC recomputation
 * @returns {{ valid: boolean, reason?: string, agentId?: string }}
 */
function verifyToken(rawToken, agentId, secret) {
  // ── 1. Decode ──────────────────────────────────────────────────────────────
  let envelope;
  try {
    const json = Buffer.from(rawToken, "base64url").toString("utf8");
    envelope   = JSON.parse(json);
  } catch {
    return { valid: false, reason: "TOKEN_MALFORMED" };
  }

  // ── 2. Shape check ─────────────────────────────────────────────────────────
  const { agentId: tokenAgentId, issuedAt, signature } = envelope;

  if (
    typeof tokenAgentId !== "string" ||
    typeof issuedAt     !== "number" ||
    typeof signature    !== "string"
  ) {
    return { valid: false, reason: "TOKEN_SCHEMA_INVALID" };
  }

  // ── 3. Agent identity check ────────────────────────────────────────────────
  if (tokenAgentId !== agentId) {
    return { valid: false, reason: "TOKEN_AGENT_MISMATCH" };
  }

  // ── 4. TTL check (before crypto — fail fast, no timing oracle) ─────────────
  const age = Date.now() - issuedAt;
  if (age < 0 || age > TOKEN_TTL_MS) {
    return { valid: false, reason: "TOKEN_EXPIRED", age };
  }

  // ── 5. Constant-time HMAC comparison (prevents timing attacks) ────────────
  const expectedPayload   = `${tokenAgentId}:${issuedAt}`;
  const expectedSignature = deriveHMAC(expectedPayload, secret);

  let signaturesMatch = false;
  try {
    // Both buffers must be same length for timingSafeEqual
    const receivedBuf = Buffer.from(signature,         TOKEN_ENCODING);
    const expectedBuf = Buffer.from(expectedSignature, TOKEN_ENCODING);

    if (receivedBuf.length === expectedBuf.length) {
      signaturesMatch = crypto.timingSafeEqual(receivedBuf, expectedBuf);
    }
  } catch {
    return { valid: false, reason: "TOKEN_CRYPTO_ERROR" };
  }

  if (!signaturesMatch) {
    return { valid: false, reason: "TOKEN_SIGNATURE_INVALID" };
  }

  return { valid: true, agentId: tokenAgentId };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  issueToken,
  verifyToken,
  TOKEN_TTL_MS,
};
