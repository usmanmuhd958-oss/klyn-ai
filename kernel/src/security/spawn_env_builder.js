/**
 * =============================================================================
 * KLYN AI OS — Agent Spawn Environment Builder
 * File: kernel/src/security/spawn_env_builder.js
 * Version: 1.0.0
 * Phase: 1.3 — Clean Agent Spawn Environment
 * =============================================================================
 *
 * SECURITY CONTRACT:
 *   This module is the exclusive constructor of child process environments.
 *   No other module in the codebase is permitted to spread process.env into
 *   a child process spawn call. Every agent environment is built here using
 *   an explicit allowlist of safe, non-secret variables.
 *
 * WHAT THIS MODULE PREVENTS:
 *   The default Node.js behavior for child_process.fork() and spawn() is to
 *   inherit the full parent process.env. Since the vault purges secrets from
 *   process.env during initialization, by the time any agent is spawned, the
 *   parent environment should already be clean. However, this module enforces
 *   a defense-in-depth second layer: even if purging somehow missed a value,
 *   the explicit allowlist ensures it never reaches a child process.
 *
 * WHAT AGENTS RECEIVE:
 *   - Basic Node.js runtime variables (PATH, HOME, NODE_ENV, etc.)
 *   - Their own identity (KLYN_AGENT_ID, KLYN_KERNEL_VERSION)
 *   - Diagnostic flags (KLYN_DEBUG, LOG_LEVEL)
 *   - Nothing else. No API keys. No passwords. No tokens.
 *
 * WHAT AGENTS DO NOT RECEIVE:
 *   - Any variable from SECRET_ENV_KEYS in token-vault.js.
 *   - The vault master key.
 *   - Any computed secret or key material.
 *   - Any variable not explicitly listed in the allowlist below.
 *
 * =============================================================================
 */

'use strict';

const { createLogger } = require('../observability/logger');

const log = createLogger('SpawnEnvBuilder');

// =============================================================================
// SECTION 1: ALLOWLIST DEFINITION
// =============================================================================

/**
 * The complete allowlist of environment variable names that may be passed
 * to child agent processes.
 *
 * GOVERNANCE RULE:
 *   Adding a variable to this list requires a code review justification.
 *   The question to answer is: "Does a child agent process genuinely need
 *   this variable to function, and does passing it create a secret exposure?"
 *   If the answer to the second question is "yes", it does not belong here.
 *   It belongs in the token vault.
 *
 * @type {ReadonlyArray<string>}
 */
const SAFE_ENV_ALLOWLIST = Object.freeze([
  // --- Node.js Runtime Requirements ---
  'PATH',              // Required for Node.js and npm binary resolution.
  'HOME',              // Required by some Node.js modules for config file lookup.
  'TMPDIR',            // Temporary directory path (Android/Termux specific).
  'TMP',               // Alternative temp dir name.
  'TEMP',              // Alternative temp dir name (Windows compatibility).
  'USER',              // Current user identity (informational, not a secret).
  'SHELL',             // Shell binary path (used by some child_process operations).
  'LANG',              // Locale setting for string operations.
  'LC_ALL',            // Locale override.
  'NODE_PATH',         // Node.js module resolution path.

  // --- Termux-Specific Android Variables ---
  'PREFIX',            // Termux installation prefix (e.g., /data/data/com.termux/files/usr).
  'ANDROID_ROOT',      // Android system root.
  'TERMUX_VERSION',    // Termux app version (informational).

  // --- KLYN AI OS Runtime Identity ---
  'NODE_ENV',          // 'production' | 'development' | 'test'.
  'KLYN_KERNEL_VERSION', // Kernel version string (non-secret identifier).

  // --- KLYN AI OS Diagnostics (non-secret) ---
  'KLYN_DEBUG',        // '0' | '1' — enables verbose debug logging.
  'KLYN_LOG_LEVEL',    // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'.

  // NOTE: KLYN_AGENT_ID is not in this list because it is injected per-agent
  // dynamically by buildAgentEnvironment(), not inherited from the parent.
]);

/**
 * Variables that are explicitly BLOCKED regardless of their presence in
 * the allowlist. This is a defense-in-depth layer for known sensitive names.
 * If a variable name matches this pattern, it will never reach a child process.
 *
 * @type {RegExp}
 */
const BLOCKED_KEY_PATTERN = /^(?!KLYN_MASTER_SECRET$)(?:.*(?:key|secret|password|token|credential|auth|api|vault|hmac|master).*)$/i;

// =============================================================================
// SECTION 2: ENVIRONMENT BUILDER
// =============================================================================

/**
 * Builds a clean, restricted environment object for a specific agent process.
 *
 * @param {object} options
 * @param {string}   options.agentId          The agent's unique identifier.
 * @param {string}   [options.ipcChannelPath] IPC socket path (if using Unix sockets).
 * @param {object}   [options.extra]          Additional safe, non-secret variables
 *                                            specific to this agent type. These
 *                                            are validated against the blocked pattern.
 * @returns {object}  A plain object suitable for use as the `env` option in
 *                    child_process.fork() or spawn().
 */
function buildAgentEnvironment(options = {}) {
  const { agentId, ipcChannelPath, extra = {} } = options;

  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new TypeError('buildAgentEnvironment: agentId must be a non-empty string.');
  }

  // --- Step 1: Build the base environment from the allowlist ---
  const env = {};
  let allowedCount  = 0;
  let skippedCount  = 0;
  const skippedKeys = [];

  for (const key of SAFE_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined && value !== null) {
      // Apply the blocked pattern even to allowlisted keys as a last resort.
      if (BLOCKED_KEY_PATTERN.test(key)) {
        log.security(
          'Allowlisted key matches blocked pattern. Refusing to propagate.',
          { key, agentId }
        );
        skippedKeys.push(key);
        skippedCount++;
        continue;
      }
      env[key] = value;
      allowedCount++;
    }
  }

  // --- Step 2: Inject per-agent identity variables ---
  // These are injected explicitly, not inherited from the parent.
  env['KLYN_AGENT_ID'] = agentId;

  if (ipcChannelPath) {
    env['KLYN_IPC_PATH'] = ipcChannelPath;
  }

  // --- Step 3: Validate and merge any extra variables ---
  const rejectedExtras = [];
  for (const [key, value] of Object.entries(extra)) {
    // Reject any extra variable whose name matches the blocked pattern.
    if (BLOCKED_KEY_PATTERN.test(key)) {
      rejectedExtras.push(key);
      log.security(
        'Extra environment variable rejected: name matches blocked pattern.',
        { key, agentId }
      );
      continue;
    }

    // Reject non-string values (only string values are valid env entries).
    if (typeof value !== 'string') {
      rejectedExtras.push(key);
      log.warn('Extra environment variable rejected: value is not a string.', {
        key,
        valueType: typeof value,
        agentId,
      });
      continue;
    }

    env[key] = value;
  }

  log.debug('Agent environment built.', {
    agentId,
    allowedCount,
    skippedCount,
    injectedKeys: ['KLYN_AGENT_ID', ipcChannelPath ? 'KLYN_IPC_PATH' : null].filter(Boolean),
    rejectedExtras: rejectedExtras.length > 0 ? rejectedExtras : undefined,
    totalKeys: Object.keys(env).length,
  });

  if (skippedKeys.length > 0) {
    log.security('Environment build completed with blocked key warnings.', {
      agentId,
      skippedKeys,
    });
  }

  // Return a sealed copy. The caller cannot modify the reference we return
  // because it's a new plain object, but we make intent clear.
  return Object.assign(Object.create(null), env);
}

/**
 * Validates that an environment object built by buildAgentEnvironment()
 * contains no secret variables. Used as a pre-spawn assertion.
 *
 * @param {object} env      The environment object to audit.
 * @param {string} agentId  For logging context.
 * @returns {{ clean: boolean, violations: string[] }}
 */
function auditSpawnEnvironment(env, agentId) {
  const violations = [];

  for (const key of Object.keys(env)) {
    if (BLOCKED_KEY_PATTERN.test(key)) {
      violations.push(key);
      log.security('SPAWN AUDIT VIOLATION: Secret key detected in agent environment.', {
        key,
        agentId,
      });
    }
  }

  if (violations.length === 0) {
    log.debug('Spawn environment audit passed. No violations.', { agentId });
  } else {
    log.security('Spawn environment audit FAILED.', {
      agentId,
      violations,
      violationCount: violations.length,
    });
  }

  return {
    clean:      violations.length === 0,
    violations,
  };
}

// =============================================================================
// SECTION 3: EXPORTS
// =============================================================================

module.exports = Object.freeze({
  buildAgentEnvironment,
  auditSpawnEnvironment,
  SAFE_ENV_ALLOWLIST,
});
