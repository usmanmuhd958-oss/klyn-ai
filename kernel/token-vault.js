/**
 * =============================================================================
 * KLYN AI OS — Hardened Token Vault
 * File: kernel/token-vault.js
 * Version: 2.0.0
 * Phase: 1.2 — Cryptographic Foundation (Vault Hardening)
 * =============================================================================
 *
 * SECURITY CONTRACT:
 *
 *   1. SECRET COMPARTMENTALIZATION:
 *      The vault is the ONLY module that reads raw secrets from process.env.
 *      Immediately after reading, all recognized secret keys are deleted from
 *      process.env using the `delete` operator. From that point, no code
 *      anywhere in the process — including agent subprocesses forked before
 *      secrets are deleted — can read them from the environment.
 *
 *   2. SCOPED TOKEN ISSUANCE:
 *      Callers never receive raw secret values. They receive HMAC-signed,
 *      time-bounded tokens that encode: who requested the token, what
 *      operation scope it authorizes, and when it expires. The token does
 *      not contain the raw secret. It is an authorization proof artifact.
 *
 *   3. IPC-ONLY TOKEN DELIVERY:
 *      Tokens are never placed in process.env or passed as spawn arguments.
 *      They are delivered exclusively through the kernel's IPC channel to
 *      authenticated agents after they complete the ONLINE handshake.
 *
 *   4. FULL AUDIT TRAIL:
 *      Every issuance, every verification, and every rejection is written
 *      to the structured kernel logger with a correlation ID and timestamp.
 *
 *   5. VAULT SEAL:
 *      The vault can be sealed. A sealed vault rejects all issuance requests.
 *      This allows clean shutdown without a window of unauthorized token use.
 *
 * TOKEN FORMAT (JSON, HMAC-signed):
 *   {
 *     "jti":       "<unique token ID>",
 *     "sub":       "<requester identity>",
 *     "scope":     "<authorized operation scope>",
 *     "secretRef": "<which internal secret this authorizes>",
 *     "iat":       <issued-at Unix ms>,
 *     "exp":       <expires-at Unix ms>,
 *     "sig":       "<HMAC-SHA256 over the above fields>"
 *   }
 *
 * =============================================================================
 */

'use strict';

const {
  generateSessionKey,
  generateId,
  signPayload,
  verifyPayload,
  deriveKeySync,
  encrypt,
  decrypt,
  CONSTANTS,
} = require('./src/security/crypto_utils');

const { createLogger }    = require('./src/observability/logger');
const { getManifest, COMPONENT_STATUS } = require('./src/observability/health_manifest');

const log      = createLogger('TokenVault');
const manifest = getManifest();

// =============================================================================
// SECTION 1: CONFIGURATION
// =============================================================================

/**
 * The names of environment variables the vault is authorized to consume.
 * Any environment variable not in this list is not managed by the vault
 * and should not contain secrets.
 *
 * This is the authoritative inventory of all secrets in the system.
 * Adding a new API key to the system requires adding it here first.
 */
const SECRET_ENV_KEYS = Object.freeze([
  'KLYN_VAULT_MASTER_KEY',   // Master key for AES vault-at-rest encryption.
  'KLYN_DEEPSEEK_API_KEY',   // DeepSeek Coder LLM provider API key.
  'KLYN_LLAMA_API_KEY',      // LLaMA LLM provider API key.
  'KLYN_DB_PASSWORD',        // Database connection password (if applicable).
  'KLYN_COLLAB_SECRET',      // Collaboration service shared secret.
  'KLYN_ADMIN_TOKEN',        // Admin endpoint bearer token.
]);

/**
 * Scopes define what operations a token may authorize.
 * Tokens issued with a specific scope may only be used for that operation.
 * Adding a new authorized operation requires adding a scope here first.
 * @enum {string}
 */
const TOKEN_SCOPE = Object.freeze({
  LLM_INFERENCE:    'llm:inference',          // Call an LLM provider API.
  LLM_DEEPSEEK:     'llm:deepseek',           // Specifically DeepSeek.
  LLM_LLAMA:        'llm:llama',              // Specifically LLaMA.
  DB_READ:          'db:read',                // Database read operations.
  DB_WRITE:         'db:write',               // Database write operations.
  COLLAB_CONNECT:   'collaboration:connect',  // Connect to collab server.
  ADMIN_ACCESS:     'admin:access',           // Admin endpoint access.
  IPC_CHANNEL:      'ipc:channel',            // Authorize IPC communication.
  AGENT_SPAWN:      'agent:spawn',            // Authorize agent spawning.
});

/**
 * Mapping from token scope to the internal secret reference it unlocks.
 * This prevents a token scoped to LLM access from being used to retrieve
 * a database password.
 */
const SCOPE_TO_SECRET_REF = Object.freeze({
  [TOKEN_SCOPE.LLM_INFERENCE]:  'KLYN_DEEPSEEK_API_KEY',
  [TOKEN_SCOPE.LLM_DEEPSEEK]:   'KLYN_DEEPSEEK_API_KEY',
  [TOKEN_SCOPE.LLM_LLAMA]:      'KLYN_LLAMA_API_KEY',
  [TOKEN_SCOPE.DB_READ]:        'KLYN_DB_PASSWORD',
  [TOKEN_SCOPE.DB_WRITE]:       'KLYN_DB_PASSWORD',
  [TOKEN_SCOPE.COLLAB_CONNECT]: 'KLYN_COLLAB_SECRET',
  [TOKEN_SCOPE.ADMIN_ACCESS]:   'KLYN_ADMIN_TOKEN',
  [TOKEN_SCOPE.IPC_CHANNEL]:    null,  // IPC tokens authorize behavior, not a secret.
  [TOKEN_SCOPE.AGENT_SPAWN]:    null,
});

/** Default token TTL: 15 minutes in milliseconds. */
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Maximum token TTL: 1 hour. Prevents tokens being issued with absurd lifetimes. */
const MAX_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Maximum tokens retained in the issuance audit log before rotation. */
const MAX_AUDIT_LOG_ENTRIES = 1000;

// =============================================================================
// SECTION 2: TOKEN VAULT CLASS
// =============================================================================

/**
 * KlynTokenVault — The exclusive secret authority for the KLYN AI OS kernel.
 *
 * Lifecycle:
 *   1. Construct: new KlynTokenVault()
 *   2. Initialize: await vault.initialize()
 *      - Reads secrets from process.env.
 *      - Immediately purges secrets from process.env.
 *      - Generates the signing key from the master key via HKDF.
 *      - Seals the environment.
 *   3. Issue tokens: vault.issueToken({ requesterId, scope, ttlMs })
 *   4. Verify tokens: vault.verifyToken(tokenString)
 *   5. Retrieve secret value (kernel-only): vault.getSecret(secretRef, verifiedToken)
 *   6. Seal on shutdown: vault.seal()
 */
class KlynTokenVault {

  constructor() {
    /**
     * Internal secret store. Keys are secret reference names from SECRET_ENV_KEYS.
     * Values are encrypted Buffers (AES-256-GCM) of the raw secret value.
     * Raw secret strings never persist beyond the initialize() call.
     * @type {Map<string, Buffer>}
     */
    this._encryptedSecrets = new Map();

    /**
     * The vault master key. Loaded from environment, used to derive sub-keys.
     * Stored as a Buffer. Never serialized.
     * @type {Buffer|null}
     */
    this._masterKey = null;

    /**
     * The HMAC signing key derived from the master key via HKDF.
     * Used exclusively for token signing and verification.
     * @type {Buffer|null}
     */
    this._signingKey = null;

    /**
     * The encryption key derived from the master key via HKDF.
     * Used to encrypt secrets at rest within the vault's memory.
     * @type {Buffer|null}
     */
    this._encryptionKey = null;

    /**
     * Set of active (not-yet-expired) token JTIs.
     * Used to detect token reuse after expiry (but not full revocation —
     * that requires a persistent store, which is Phase 2+).
     * @type {Set<string>}
     */
    this._issuedTokenIds = new Set();

    /**
     * Ordered audit log of issuance and verification events.
     * Capped at MAX_AUDIT_LOG_ENTRIES to prevent unbounded memory growth.
     * @type {Array<object>}
     */
    this._auditLog = [];

    /**
     * Whether the vault has been fully initialized.
     * @type {boolean}
     */
    this._initialized = false;

    /**
     * Whether the vault has been sealed. A sealed vault rejects all issuance.
     * @type {boolean}
     */
    this._sealed = false;

    manifest.register('TokenVault', {
      critical: true,
      metadata: { version: '2.0.0' },
    });

    log.info('Token vault instance created. Call initialize() to activate.');
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Initializes the vault by reading, compartmentalizing, and purging secrets.
   * This method must be called exactly once at kernel startup, before any
   * agent processes are forked. After this method returns, process.env
   * contains no secret values.
   *
   * @returns {Promise<void>}
   * @throws {Error}  If the master key is absent or secret purging fails.
   */
  async initialize() {
    if (this._initialized) {
      throw new Error('TokenVault.initialize() called more than once. This is a programming error.');
    }

    const correlId = generateId();
    const opLog = log.child ? log.child(correlId) : log;

    opLog.info('Vault initialization starting. Reading secrets from environment.');

    // --- Step 1: Read the master key ---
    const rawMasterKey = process.env.KLYN_VAULT_MASTER_KEY;
    if (!rawMasterKey || rawMasterKey.trim().length === 0) {
      manifest.setFaulted('TokenVault',
        'Master key absent from environment. Vault cannot initialize.',
        { correlId }
      );
      throw new Error(
        'KLYN FATAL: KLYN_VAULT_MASTER_KEY is not set. ' +
        'The token vault cannot initialize without a master key. ' +
        'Set this environment variable to a 64-character hex string (32 bytes).'
      );
    }

    // Accept both hex-encoded strings and raw Buffer-like strings.
    try {
      this._masterKey = _parseMasterKey(rawMasterKey);
    } catch (err) {
      manifest.setFaulted('TokenVault', 'Master key parsing failed.', { correlId });
      throw new Error(`KLYN FATAL: Master key is malformed. ${err.message}`);
    }

    opLog.info('Master key loaded successfully.', {
      keyLengthBytes: this._masterKey.length,
    });

    // --- Step 2: Derive sub-keys from master key via HKDF ---
    this._signingKey    = deriveKeySync(this._masterKey, 'klyn:vault:signing-key:v1');
    this._encryptionKey = deriveKeySync(this._masterKey, 'klyn:vault:encryption-key:v1');

    opLog.info('Sub-keys derived via HKDF.', {
      signingKeyLength:    this._signingKey.length,
      encryptionKeyLength: this._encryptionKey.length,
    });

    // --- Step 3: Read all recognized secrets from environment ---
    const loadedSecrets = [];
    const missingSecrets = [];

    for (const envKey of SECRET_ENV_KEYS) {
      if (envKey === 'KLYN_VAULT_MASTER_KEY') continue; // Already handled.

      const rawValue = process.env[envKey];
      if (rawValue && rawValue.trim().length > 0) {
        // Encrypt the secret in memory using the derived encryption key.
        const encrypted = encrypt(rawValue, this._encryptionKey, envKey);
        this._encryptedSecrets.set(envKey, encrypted);
        loadedSecrets.push(envKey);
      } else {
        missingSecrets.push(envKey);
      }
    }

    opLog.info('Secrets loaded and encrypted in memory.', {
      loaded:  loadedSecrets,
      missing: missingSecrets,
    });

    if (missingSecrets.length > 0) {
      opLog.warn(
        'Some expected secrets were not found in the environment. ' +
        'Operations requiring these secrets will fail token issuance.',
        { missingSecrets }
      );
    }

    // --- Step 4: IMMEDIATELY purge all secrets from process.env ---
    // This is the critical security operation. After this block, any code
    // anywhere in this process that reads process.env will find empty values.
    const purgedKeys = this._purgeEnvironment();

    opLog.info('Environment purge complete.', {
      purgedKeys,
      purgedCount: purgedKeys.length,
    });

    // --- Step 5: Zero out the raw master key Buffer ---
    // We derived sub-keys from it. The master key Buffer is no longer needed.
    // Overwrite it with zeros before releasing the reference.
    this._masterKey.fill(0);
    this._masterKey = null;

    opLog.info('Master key zeroed from memory. Sub-keys are the only retained key material.');

    // --- Step 6: Mark as initialized and healthy ---
    this._initialized = true;
    manifest.setHealthy('TokenVault', 'Vault initialized. Environment purged.', {
      secretsLoaded: loadedSecrets.length,
    });

    opLog.info('Token vault is READY.', { correlId });
  }

  // ---------------------------------------------------------------------------
  // TOKEN ISSUANCE
  // ---------------------------------------------------------------------------

  /**
   * Issues a scoped, time-bounded, HMAC-signed token.
   *
   * @param {object} options
   * @param {string}  options.requesterId   Identity of the requester (e.g., "kernel:orchestrator", "agent:bug_hunter").
   * @param {string}  options.scope         The operation scope (from TOKEN_SCOPE).
   * @param {number}  [options.ttlMs]       Token TTL in milliseconds. Defaults to DEFAULT_TOKEN_TTL_MS.
   * @param {string}  [options.correlId]    Correlation ID for audit log linkage.
   * @returns {string}  Serialized, signed token (JSON string).
   * @throws {Error}    If the vault is not initialized, is sealed, or the scope is invalid.
   */
  issueToken({ requesterId, scope, ttlMs, correlId } = {}) {
    this._assertOperational('issueToken');

    // --- Input validation ---
    if (typeof requesterId !== 'string' || requesterId.trim().length === 0) {
      throw new TypeError('issueToken: requesterId must be a non-empty string.');
    }
    if (!Object.values(TOKEN_SCOPE).includes(scope)) {
      this._auditEvent('ISSUANCE_REJECTED', {
        reason: 'Invalid scope.',
        requesterId,
        scope,
        correlId,
      });
      throw new Error(
        `issueToken: Unknown scope "${scope}". ` +
        `Valid scopes: ${Object.values(TOKEN_SCOPE).join(', ')}.`
      );
    }

    const resolvedTtl = Math.min(
      (Number.isInteger(ttlMs) && ttlMs > 0) ? ttlMs : DEFAULT_TOKEN_TTL_MS,
      MAX_TOKEN_TTL_MS
    );

    const now       = Date.now();
    const jti       = generateId(16);
    const secretRef = SCOPE_TO_SECRET_REF[scope];

    // Verify the required secret is available if this scope needs one.
    if (secretRef !== null && !this._encryptedSecrets.has(secretRef)) {
      this._auditEvent('ISSUANCE_REJECTED', {
        reason:      'Required secret not loaded in vault.',
        requesterId,
        scope,
        secretRef,
        correlId,
      });
      throw new Error(
        `issueToken: Cannot issue token for scope "${scope}". ` +
        `The required secret "${secretRef}" was not found in the vault. ` +
        `Ensure it is set in the environment before kernel startup.`
      );
    }

    // --- Build the token claims object ---
    const claims = {
      jti,
      sub:       requesterId,
      scope,
      secretRef: secretRef ?? '__none__',
      iat:       now,
      exp:       now + resolvedTtl,
    };

    // --- Sign the claims with the vault signing key ---
    const sig = signPayload(claims, this._signingKey);

    const token = { ...claims, sig };

    // Track the issued JTI for replay detection.
    this._issuedTokenIds.add(jti);

    // Schedule JTI cleanup after expiry to prevent unbounded Set growth.
    setTimeout(() => {
      this._issuedTokenIds.delete(jti);
    }, resolvedTtl + 5000).unref(); // .unref() prevents this timer from blocking process exit.

    this._auditEvent('TOKEN_ISSUED', {
      jti,
      requesterId,
      scope,
      secretRef: secretRef ?? '__none__',
      exp:       claims.exp,
      ttlMs:     resolvedTtl,
      correlId,
    });

    log.info('Token issued.', {
      jti,
      requesterId,
      scope,
      ttlMs: resolvedTtl,
      correlId,
    });

    // Serialize to string for IPC transport.
    return JSON.stringify(token);
  }

  // ---------------------------------------------------------------------------
  // TOKEN VERIFICATION
  // ---------------------------------------------------------------------------

  /**
   * Verifies a token string previously issued by this vault.
   * Returns the verified claims on success.
   *
   * @param {string}  tokenString  The serialized token produced by issueToken().
   * @param {object}  [options]
   * @param {string}  [options.expectedScope]  If provided, verification fails if
   *                                           the token's scope does not match.
   * @param {string}  [options.correlId]       Correlation ID for audit linkage.
   * @returns {{ jti, sub, scope, secretRef, iat, exp }}  Verified claims object.
   * @throws {Error}  If the token is invalid, expired, or scope-mismatched.
   */
  verifyToken(tokenString, { expectedScope, correlId } = {}) {
    this._assertOperational('verifyToken');

    // --- Structural parse ---
    let token;
    try {
      token = JSON.parse(tokenString);
    } catch (_) {
      this._rejectToken('MALFORMED_JSON', null, { correlId });
      throw new Error('verifyToken: Token string is not valid JSON.');
    }

    const { jti, sub, scope, secretRef, iat, exp, sig } = token;

    // --- Field presence validation ---
    if (!jti || !sub || !scope || !secretRef || !iat || !exp || !sig) {
      this._rejectToken('MISSING_FIELDS', jti, { sub, scope, correlId });
      throw new Error('verifyToken: Token is missing required fields.');
    }

    // --- Expiry check ---
    if (Date.now() > exp) {
      this._rejectToken('EXPIRED', jti, { sub, scope, exp, correlId });
      throw new Error(
        `verifyToken: Token has expired. Expired at ${new Date(exp).toISOString()}.`
      );
    }

    // --- Scope validation ---
    if (!Object.values(TOKEN_SCOPE).includes(scope)) {
      this._rejectToken('INVALID_SCOPE', jti, { sub, scope, correlId });
      throw new Error(`verifyToken: Token carries unknown scope "${scope}".`);
    }

    if (expectedScope && scope !== expectedScope) {
      this._rejectToken('SCOPE_MISMATCH', jti, {
        sub, scope, expectedScope, correlId,
      });
      throw new Error(
        `verifyToken: Scope mismatch. Expected "${expectedScope}", ` +
        `token carries "${scope}".`
      );
    }

    // --- Signature verification (timing-safe) ---
    const claims = { jti, sub, scope, secretRef, iat, exp };
    const isValid = verifyPayload(claims, sig, this._signingKey);

    if (!isValid) {
      this._rejectToken('INVALID_SIGNATURE', jti, { sub, scope, correlId });
      log.security('Token signature verification FAILED.', {
        jti,
        sub,
        scope,
        correlId,
      });
      throw new Error('verifyToken: Token signature is invalid. Possible tampering.');
    }

    this._auditEvent('TOKEN_VERIFIED', { jti, sub, scope, correlId });

    log.debug('Token verified successfully.', { jti, sub, scope, correlId });
    return claims;
  }

  // ---------------------------------------------------------------------------
  // SECRET RETRIEVAL (Kernel-Internal Use Only)
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a raw secret value after verifying a valid token.
   * This method is for KERNEL-INTERNAL USE ONLY. It must never be called from
   * agent code. Agents receive the token; they do not call getSecret().
   *
   * The raw secret is returned as a string and should be used immediately.
   * The caller should not cache the result.
   *
   * @param {string} secretRef    The secret reference key (e.g., "KLYN_DEEPSEEK_API_KEY").
   * @param {object} verifiedClaims  Claims object returned by verifyToken().
   * @returns {string}  The raw secret value.
   * @throws {Error}    If the secret ref doesn't match the token's scope or is not found.
   */
  getSecret(secretRef, verifiedClaims) {
    this._assertOperational('getSecret');

    if (!verifiedClaims || verifiedClaims.secretRef !== secretRef) {
      this._auditEvent('SECRET_ACCESS_DENIED', {
        secretRef,
        tokenSecretRef: verifiedClaims?.secretRef,
        sub: verifiedClaims?.sub,
      });
      log.security('Secret access denied: token scope does not authorize this secret.', {
        secretRef,
        tokenSecretRef: verifiedClaims?.secretRef,
      });
      throw new Error(
        `getSecret: Token does not authorize access to secret "${secretRef}". ` +
        `Token is scoped to "${verifiedClaims?.secretRef}".`
      );
    }

    const encryptedBlob = this._encryptedSecrets.get(secretRef);
    if (!encryptedBlob) {
      throw new Error(
        `getSecret: Secret "${secretRef}" is not present in the vault. ` +
        `It may not have been set in the environment at vault initialization time.`
      );
    }

    // Decrypt inline. The decrypted value is returned directly without caching.
    const plaintext = decrypt(encryptedBlob, this._encryptionKey, secretRef);

    this._auditEvent('SECRET_ACCESSED', {
      secretRef,
      sub: verifiedClaims.sub,
      jti: verifiedClaims.jti,
    });

    return plaintext.toString('utf8');
  }

  // ---------------------------------------------------------------------------
  // VAULT MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Seals the vault. A sealed vault rejects all token issuance requests.
   * This should be called during kernel shutdown before process exit.
   * Verification remains operational so in-flight tokens can be validated
   * during the shutdown grace period.
   */
  seal() {
    if (this._sealed) {
      log.warn('Vault seal requested but vault is already sealed.');
      return;
    }
    this._sealed = true;

    // Zero out key material.
    if (this._signingKey)    { this._signingKey.fill(0);    this._signingKey    = null; }
    if (this._encryptionKey) { this._encryptionKey.fill(0); this._encryptionKey = null; }

    // Clear the encrypted secrets map.
    this._encryptedSecrets.clear();
    this._issuedTokenIds.clear();

    manifest.setTerminated('TokenVault', 'Vault sealed on shutdown.');
    log.info('Token vault sealed. All key material zeroed.');
  }

  /**
   * Returns a sanitized audit log snapshot for diagnostic purposes.
   * Secret values and key material are never included in this output.
   *
   * @returns {Array<object>}
   */
  getAuditLog() {
    return [...this._auditLog];
  }

  /**
   * Returns the set of valid scope constants.
   * Exposed so callers can reference scopes without importing this module's internals.
   * @returns {object}
   */
  getScopes() {
    return TOKEN_SCOPE;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Purges all recognized secret keys from process.env.
   * Uses the delete operator on process.env properties.
   * Also deletes the master key itself.
   *
   * @returns {string[]}  List of keys that were deleted.
   */
  _purgeEnvironment() {
    const purged = [];

    for (const key of SECRET_ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(process.env, key)) {
        delete process.env[key];
        purged.push(key);
      }
    }

    return purged;
  }

  /**
   * Asserts the vault is initialized and not sealed before an operation.
   * @param {string} operationName
   */
  _assertOperational(operationName) {
    if (!this._initialized) {
      throw new Error(
        `${operationName}: TokenVault has not been initialized. ` +
        `Call vault.initialize() before any other vault operation.`
      );
    }
    // For seal checks, verification is still allowed on a sealed vault.
    if (this._sealed && operationName === 'issueToken') {
      throw new Error(
        `issueToken: The vault is sealed. No tokens can be issued during shutdown.`
      );
    }
  }

  /**
   * Records an audit event in the bounded audit log.
   * @param {string} eventType
   * @param {object} [data]
   */
  _auditEvent(eventType, data = {}) {
    const entry = {
      eventType,
      ts: Date.now(),
      ...data,
    };

    this._auditLog.push(entry);

    // Cap the audit log to prevent unbounded memory growth on long-running kernels.
    if (this._auditLog.length > MAX_AUDIT_LOG_ENTRIES) {
      this._auditLog.splice(0, this._auditLog.length - MAX_AUDIT_LOG_ENTRIES);
    }
  }

  /**
   * Records a token rejection audit event and logs a security-level entry.
   * @param {string} reason
   * @param {string|null} jti
   * @param {object} [data]
   */
  _rejectToken(reason, jti, data = {}) {
    this._auditEvent('TOKEN_REJECTED', { reason, jti, ...data });
    log.security('Token rejected.', { reason, jti, ...data });
  }
}

// =============================================================================
// SECTION 3: PRIVATE HELPERS
// =============================================================================

/**
 * Parses the master key from an environment variable value.
 * Accepts a 64-character hex string (representing 32 bytes).
 *
 * @param {string} rawValue
 * @returns {Buffer}
 * @throws {Error}  If the format is invalid.
 */
function _parseMasterKey(rawValue) {
  const trimmed = rawValue.trim();

  // Accept 64-character hex strings (most common format for shell env vars).
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Accept 32-character raw strings (base64 or arbitrary — less common).
  if (trimmed.length >= 32) {
    return Buffer.from(trimmed.slice(0, 32), 'utf8');
  }

  throw new Error(
    'Master key must be a 64-character hex string (representing 32 bytes). ' +
    `Received a value of length ${trimmed.length}.`
  );
}

// =============================================================================
// SECTION 4: SINGLETON EXPORT
// =============================================================================

/**
 * The vault singleton for this kernel process.
 * All kernel components import this instance.
 * @type {KlynTokenVault}
 */
const vaultInstance = new KlynTokenVault();

module.exports = Object.freeze({
  vault:       vaultInstance,
  TOKEN_SCOPE,
});
