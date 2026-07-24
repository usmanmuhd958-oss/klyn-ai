/**
 * =============================================================================
 * KLYN AI OS — Vault Interface (Restricted Proxy)
 * File: kernel/src/lifecycle/vault_interface.js
 * Version: 1.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * PURPOSE:
 *   The Orchestrator must be able to request tokens from the vault at runtime
 *   (for example, when issuing IPC tokens for newly spawned agents).
 *   However, the Orchestrator must NOT have access to:
 *     - The vault's seal() method (only kernel-entry.js controls sealing).
 *     - The vault's getSecret() method (only kernel services access secrets).
 *     - The vault's internal audit log.
 *     - The vault's initialization state or key material.
 *
 *   This module creates a RESTRICTED PROXY over the vault singleton that
 *   exposes ONLY the operations the Orchestrator legitimately needs:
 *     - issueToken()   — Request a scoped, time-bounded token.
 *     - verifyToken()  — Verify a token's authenticity and scope.
 *     - getScopes()    — Read the list of valid scope constants.
 *
 *   Any call to a non-exposed vault method through this proxy throws an
 *   error immediately, making capability violations visible at development
 *   time rather than silently succeeding.
 *
 * PRINCIPLE OF LEAST PRIVILEGE:
 *   The Orchestrator is a powerful component. The vault is the most
 *   security-critical component. Their interface should be as narrow
 *   as possible. This module enforces that narrowness structurally.
 *
 * =============================================================================
 */
'use strict';
const { createLogger } = require('../observability/logger');
const log = createLogger('VaultInterface');
// =============================================================================
// SECTION 1: ALLOWED OPERATIONS
// =============================================================================
/**
 * The explicit whitelist of vault methods accessible through the restricted proxy.
 * Any method not in this set will be blocked by the proxy handler.
 * @type {ReadonlySet<string>}
 */
const ALLOWED_VAULT_OPERATIONS = new Set([
    'issueToken',
    'verifyToken',
    'getScopes',
]);
// =============================================================================
// SECTION 2: VAULT INTERFACE FACTORY
// =============================================================================
/**
 * Creates a restricted proxy around the vault singleton.
 *
 * The proxy uses a JavaScript Proxy object with a custom 'get' trap that
 * whitelists allowed properties and throws on any access to non-allowed
 * properties. This is enforced at runtime for every property access, not
 * just at construction time.
 *
 * @param {object} vaultSingleton  The full vault instance from token-vault.js.
 * @returns {Proxy}  A restricted proxy exposing only allowed operations.
 * @throws {TypeError}  If vaultSingleton is not a valid vault instance.
 */
function createVaultInterface(vaultSingleton) {
    if (!vaultSingleton || typeof vaultSingleton.issueToken !== 'function') {
        throw new TypeError('createVaultInterface: vaultSingleton must be an initialized TokenVault instance.');
    }
    const proxy = new Proxy(vaultSingleton, {
        get(target, property, receiver) {
            // Allow Symbol access for built-in JavaScript operations
            // (e.g., Symbol.toPrimitive, Symbol.toStringTag).
            if (typeof property === 'symbol') {
                return Reflect.get(target, property, receiver);
            }
            // Allow 'then' to be undefined so the proxy is not mistaken for
            // a Promise by async/await machinery.
            if (property === 'then') {
                return undefined;
            }
            if (!ALLOWED_VAULT_OPERATIONS.has(property)) {
                log.security('Unauthorized vault operation attempted through restricted interface.', {
                    attemptedProperty: String(property),
                    allowedOperations: [...ALLOWED_VAULT_OPERATIONS],
                });
                throw new Error(`VaultInterface: Operation "${String(property)}" is not permitted ` +
                    `through the restricted vault interface. ` +
                    `Allowed operations: ${[...ALLOWED_VAULT_OPERATIONS].join(', ')}.`);
            }
            const value = Reflect.get(target, property, receiver);
            // Bind methods to the original target to preserve 'this' context.
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        },
        set(target, property) {
            // The vault's state is never mutated through this proxy.
            log.security('Attempt to set property on restricted vault interface blocked.', {
                property: String(property),
            });
            throw new Error('VaultInterface: The restricted vault interface is read-only. ' +
                'Vault state cannot be mutated through this proxy.');
        },
        deleteProperty(target, property) {
            log.security('Attempt to delete property on restricted vault interface blocked.', {
                property: String(property),
            });
            throw new Error('VaultInterface: Property deletion is not permitted on the vault interface.');
        },
    });
    log.info('Restricted vault interface created.', {
        allowedOperations: [...ALLOWED_VAULT_OPERATIONS],
    });
    return proxy;
}
// =============================================================================
// SECTION 3: EXPORTS
// =============================================================================
module.exports = Object.freeze({
    createVaultInterface,
    ALLOWED_VAULT_OPERATIONS,
});
export {};
