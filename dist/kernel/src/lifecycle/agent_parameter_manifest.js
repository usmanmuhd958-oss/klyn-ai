/**
 * =============================================================================
 * KLYN AI OS — Agent Parameter Manifest
 * File: kernel/src/lifecycle/agent_parameter_manifest.js
 * Version: 1.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * ARCHITECTURAL PURPOSE:
 *   The AgentParameterManifest is the sealed, immutable configuration
 *   contract passed from kernel-entry.js to the Orchestrator at boot time.
 *
 *   It is the ONLY configuration surface the Orchestrator is permitted
 *   to consume. The Orchestrator's constructor accepts this manifest and
 *   nothing else. It does not call process.env directly. It does not import
 *   the vault. It operates exclusively on the values encoded here.
 *
 * WHAT THE MANIFEST CONTAINS:
 *   - The list of agents to be managed (the agent registry).
 *   - IPC channel configuration parameters.
 *   - Health check and circuit breaker thresholds.
 *   - Spawn policy (retries, timeouts, backoff).
 *   - Kernel identity and version metadata.
 *   - References to vault-issued boot tokens (not raw secrets).
 *   - The health manifest singleton reference.
 *   - The IPC mailbox singleton reference.
 *
 * WHAT THE MANIFEST DOES NOT CONTAIN:
 *   - Raw secret values of any kind.
 *   - API keys, passwords, or cryptographic key material.
 *   - Direct references to the vault's internal state.
 *   - Any value that would grant an agent access to secrets.
 *
 * IMMUTABILITY GUARANTEE:
 *   The manifest is deep-frozen after construction. Any attempt to modify
 *   it after creation throws a TypeError in strict mode. This prevents
 *   a compromised downstream module from injecting values into the manifest
 *   after the security-conscious kernel-entry.js constructed it.
 *
 * =============================================================================
 */
'use strict';
const { createLogger } = require('../observability/logger');
const log = createLogger('AgentParameterManifest');
// =============================================================================
// SECTION 1: AGENT DEFINITION SCHEMA
// =============================================================================
/**
 * Validates a single agent definition entry.
 * Each agent entry must conform to this schema before being accepted.
 *
 * @param {object} entry
 * @param {string} agentId  Used in error messages.
 * @throws {TypeError}  If any field is invalid.
 */
function _validateAgentDefinition(entry, agentId) {
    if (typeof entry.module !== 'string' || entry.module.trim().length === 0) {
        throw new TypeError(`AgentParameterManifest: Agent "${agentId}" is missing a valid "module" string.`);
    }
    if (typeof entry.description !== 'string') {
        throw new TypeError(`AgentParameterManifest: Agent "${agentId}" is missing a "description" string.`);
    }
    if (typeof entry.critical !== 'boolean') {
        throw new TypeError(`AgentParameterManifest: Agent "${agentId}" must have a boolean "critical" field.`);
    }
}
/**
 * Validates the full agent registry map.
 * @param {object} registry
 * @throws {TypeError|RangeError}
 */
function _validateAgentRegistry(registry) {
    if (typeof registry !== 'object' || registry === null || Array.isArray(registry)) {
        throw new TypeError('AgentParameterManifest: agentRegistry must be a plain object.');
    }
    const entries = Object.entries(registry);
    if (entries.length === 0) {
        throw new RangeError('AgentParameterManifest: agentRegistry must contain at least one agent definition.');
    }
    for (const [agentId, definition] of entries) {
        if (typeof agentId !== 'string' || agentId.trim().length === 0) {
            throw new TypeError('AgentParameterManifest: All agentRegistry keys must be non-empty strings.');
        }
        _validateAgentDefinition(definition, agentId);
    }
}
// =============================================================================
// SECTION 2: SPAWN POLICY SCHEMA
// =============================================================================
/**
 * Default spawn policy values.
 * All values are conservative for Termux/Android hardware constraints.
 */
const DEFAULT_SPAWN_POLICY = Object.freeze({
    maxRetries: 3,
    retryBaseDelayMs: 1_000,
    onlineTimeoutMs: 30_000,
    readyTimeoutMs: 20_000,
    shutdownGraceMs: 5_000,
    ipcTokenTtlMs: 60 * 60 * 1000, // 1 hour.
    spawnTokenTtlMs: 60_000, // 60 seconds.
});
/**
 * Validates and merges caller-supplied spawn policy with defaults.
 * @param {object} [overrides]
 * @returns {object}  Merged, validated spawn policy.
 */
function _resolveSpawnPolicy(overrides = {}) {
    const merged = { ...DEFAULT_SPAWN_POLICY, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            throw new TypeError(`AgentParameterManifest: spawnPolicy.${key} must be a positive integer. ` +
                `Received: ${value}.`);
        }
    }
    return merged;
}
// =============================================================================
// SECTION 3: MANIFEST CLASS
// =============================================================================
/**
 * AgentParameterManifest — Sealed, immutable configuration contract.
 *
 * Constructed ONCE by kernel-entry.js and passed to the Orchestrator.
 * After construction, no field can be mutated. No secret values are stored.
 *
 * @param {object} options
 * @param {object}  options.agentRegistry          Agent definition map.
 * @param {object}  options.spawnPolicy            Spawn timing and retry parameters.
 * @param {string}  options.kernelId               Kernel identity string.
 * @param {string}  options.kernelVersion          Kernel version string.
 * @param {string}  options.agentsDir              Absolute path to agents directory.
 * @param {object}  options.ipcConfig              IPC mailbox configuration.
 * @param {object}  options.healthManifest         Kernel health manifest singleton.
 * @param {object}  options.mailbox                IPC mailbox singleton.
 * @param {object}  options.vaultInterface          Restricted vault interface (issue/verify only).
 * @param {object}  [options.metadata]             Optional boot-time metadata.
 */
class AgentParameterManifest {
    constructor(options = {}) {
        const { 
        // @ts-ignore
        agentRegistry, 
        // @ts-ignore
        spawnPolicy, 
        // @ts-ignore
        kernelId, 
        // @ts-ignore
        kernelVersion, 
        // @ts-ignore
        agentsDir, 
        // @ts-ignore
        ipcConfig, 
        // @ts-ignore
        healthManifest, 
        // @ts-ignore
        mailbox, 
        // @ts-ignore
        vaultInterface, 
        // @ts-ignore
        metadata = {}, } = options;
        // --- Validate required fields ---
        _validateAgentRegistry(agentRegistry);
        if (typeof kernelId !== 'string' || kernelId.trim().length === 0) {
            throw new TypeError('AgentParameterManifest: kernelId must be a non-empty string.');
        }
        if (typeof kernelVersion !== 'string' || kernelVersion.trim().length === 0) {
            throw new TypeError('AgentParameterManifest: kernelVersion must be a non-empty string.');
        }
        if (typeof agentsDir !== 'string' || agentsDir.trim().length === 0) {
            throw new TypeError('AgentParameterManifest: agentsDir must be a non-empty string.');
        }
        if (!healthManifest || typeof healthManifest.setHealthy !== 'function') {
            throw new TypeError('AgentParameterManifest: healthManifest must be a valid KlynHealthManifest instance.');
        }
        if (!mailbox || typeof mailbox.send !== 'function') {
            throw new TypeError('AgentParameterManifest: mailbox must be a valid KlynIPCMailbox instance.');
        }
        if (!vaultInterface || typeof vaultInterface.issueToken !== 'function') {
            throw new TypeError('AgentParameterManifest: vaultInterface must expose issueToken and verifyToken.');
        }
        const resolvedSpawnPolicy = _resolveSpawnPolicy(spawnPolicy);
        // --- Assign all fields ---
        // Deep freeze is applied after assignment below.
        // @ts-ignore
        this.agentRegistry = agentRegistry;
        // @ts-ignore
        this.spawnPolicy = resolvedSpawnPolicy;
        // @ts-ignore
        this.kernelId = kernelId.trim();
        // @ts-ignore
        this.kernelVersion = kernelVersion.trim();
        // @ts-ignore
        this.agentsDir = agentsDir.trim();
        // @ts-ignore
        this.ipcConfig = ipcConfig || {};
        // @ts-ignore
        this.healthManifest = healthManifest;
        // @ts-ignore
        this.mailbox = mailbox;
        // @ts-ignore
        this.vaultInterface = vaultInterface;
        // @ts-ignore
        this.metadata = { ...metadata, createdAt: Date.now() };
        // Deep-freeze the manifest. Object references (healthManifest, mailbox,
        // vaultInterface) are frozen at the reference level — their internal state
        // can still change (that is intentional), but the references cannot be
        // replaced.
        _deepFreeze(this);
        log.info('AgentParameterManifest constructed and sealed.', {
            kernelId,
            kernelVersion,
            agentCount: Object.keys(agentRegistry).length,
            agentIds: Object.keys(agentRegistry),
        });
    }
    // ---------------------------------------------------------------------------
    // QUERY METHODS
    // ---------------------------------------------------------------------------
    /**
     * Returns the agent definition for a given agentId.
     * @param {string} agentId
     * @returns {object|null}
     */
    getAgentDefinition(agentId) {
        // @ts-ignore
        return this.agentRegistry[agentId] ?? null;
    }
    /**
     * Returns an array of all registered agent IDs.
     * @returns {string[]}
     */
    getAgentIds() {
        // @ts-ignore
        return Object.keys(this.agentRegistry);
    }
    /**
     * Returns all agent definitions as an iterable [agentId, definition] pair array.
     * @returns {Array<[string, object]>}
     */
    getAgentEntries() {
        // @ts-ignore
        return Object.entries(this.agentRegistry);
    }
    /**
     * Returns the spawn policy value for a specific key.
     * @param {string} key
     * @returns {number}
     */
    getSpawnParam(key) {
        // @ts-ignore
        return this.spawnPolicy[key];
    }
    /**
     * Returns a serializable summary for logging and health endpoints.
     * Does not include sensitive references (mailbox, vault, health manifest).
     * @returns {object}
     */
    toSummary() {
        return {
            // @ts-ignore
            kernelId: this.kernelId,
            // @ts-ignore
            kernelVersion: this.kernelVersion,
            // @ts-ignore
            agentsDir: this.agentsDir,
            // @ts-ignore
            agentCount: Object.keys(this.agentRegistry).length,
            // @ts-ignore
            agentIds: Object.keys(this.agentRegistry),
            // @ts-ignore
            spawnPolicy: { ...this.spawnPolicy },
            // @ts-ignore
            metadata: { ...this.metadata },
        };
    }
}
// =============================================================================
// SECTION 4: DEEP FREEZE UTILITY
// =============================================================================
/**
 * Recursively freezes an object and all its plain-object properties.
 * Does NOT freeze class instances (mailbox, vault, healthManifest) because
 * they are stateful objects whose internal state must be mutable.
 *
 * @param {object} obj
 * @returns {object}  The frozen object.
 */
function _deepFreeze(obj) {
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
        const value = obj[key];
        if (value !== null &&
            typeof value === 'object' &&
            !Object.isFrozen(value) &&
            // Do not freeze class instances — only plain objects and arrays.
            Object.getPrototypeOf(value) === Object.prototype) {
            _deepFreeze(value);
        }
    }
    return obj;
}
// =============================================================================
// SECTION 5: MANIFEST BUILDER FACTORY
// =============================================================================
/**
 * Constructs an AgentParameterManifest from validated options.
 * This is the primary factory function used by kernel-entry.js.
 *
 * @param {object} options  See AgentParameterManifest constructor.
 * @returns {AgentParameterManifest}
 */
function buildManifest(options) {
    return new AgentParameterManifest(options);
}
// =============================================================================
// SECTION 6: EXPORTS
// =============================================================================
module.exports = Object.freeze({
    buildManifest,
    AgentParameterManifest,
    DEFAULT_SPAWN_POLICY,
});
export {};
