/**
 * =============================================================================
 * KLYN AI OS — Kernel Health Manifest
 * File: kernel/src/observability/health_manifest.js
 * Version: 1.0.0
 * Phase: 0 — Instrumentation
 * =============================================================================
 *
 * DESIGN CONTRACT:
 *   - The health manifest is the authoritative, synchronous runtime state
 *     snapshot of every kernel-managed component. It is never async.
 *   - The healer reads the manifest to make reconciliation decisions.
 *   - The status HTTP endpoint exposes the manifest to external monitors.
 *   - Components register themselves with the manifest and update their
 *     status atomically. The manifest never queries components directly,
 *     preventing circular dependencies.
 *   - All timestamps are Unix milliseconds (Date.now()) for fast arithmetic
 *     in circuit-breaker and SLA calculations.
 *
 * COMPONENT STATUS VALUES:
 *   INITIALIZING → HEALTHY → DEGRADED → FAULTED → TERMINATED
 *
 * =============================================================================
 */

'use strict';

const { createLogger }           = require('./logger');
const { generateCorrelationId }  = require('./logger');

const log = createLogger('HealthManifest');

// =============================================================================
// SECTION 1: STATUS CONSTANTS
// =============================================================================

/**
 * Valid component status values.
 * These form the state machine vocabulary for the reconciliation engine.
 * @enum {string}
 */
const COMPONENT_STATUS = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  HEALTHY:      'HEALTHY',
  DEGRADED:     'DEGRADED',   // Operational but with reduced capability.
  FAULTED:      'FAULTED',    // Non-operational, remediation pending.
  TERMINATED:   'TERMINATED', // Intentionally stopped.
});

/**
 * Valid manifest-level health summaries, derived from component statuses.
 * @enum {string}
 */
const SYSTEM_HEALTH = Object.freeze({
  BOOTING:  'BOOTING',   // Not all components have reached HEALTHY yet.
  HEALTHY:  'HEALTHY',   // All critical components are HEALTHY.
  DEGRADED: 'DEGRADED',  // One or more critical components are DEGRADED.
  CRITICAL: 'CRITICAL',  // One or more critical components are FAULTED.
});

// =============================================================================
// SECTION 2: COMPONENT RECORD
// =============================================================================

/**
 * Represents the runtime health state of a single registered component.
 * Instances are created internally by the manifest; callers receive a handle.
 */
class ComponentRecord {

  /**
   * @param {string}  componentId   Unique identifier for this component.
   * @param {object}  options
   * @param {boolean} [options.critical=false]  Whether this component's fault
   *                                            elevates the system to CRITICAL.
   * @param {object}  [options.metadata]        Static component metadata.
   */
  constructor(componentId, options = {}) {
    this.componentId   = componentId;
    this.critical      = options.critical   ?? false;
    this.metadata      = options.metadata   ?? {};
    this.status        = COMPONENT_STATUS.INITIALIZING;
    this.statusDetail  = 'Component is initializing.';
    this.registeredAt  = Date.now();
    this.updatedAt     = Date.now();
    this.lastHealthyAt = null;
    this.faultCount    = 0;
    this.lastFault     = null;
    this.metrics       = {};
  }

  /**
   * Produces a plain serializable snapshot of this record.
   * @returns {object}
   */
  snapshot() {
    return {
      componentId:   this.componentId,
      critical:      this.critical,
      status:        this.status,
      statusDetail:  this.statusDetail,
      registeredAt:  this.registeredAt,
      updatedAt:     this.updatedAt,
      lastHealthyAt: this.lastHealthyAt,
      faultCount:    this.faultCount,
      lastFault:     this.lastFault,
      metrics:       { ...this.metrics },
      metadata:      { ...this.metadata },
    };
  }
}

// =============================================================================
// SECTION 3: HEALTH MANIFEST CLASS
// =============================================================================

/**
 * KlynHealthManifest — Authoritative runtime state registry for the kernel.
 *
 * Usage pattern:
 *   // At module initialization:
 *   const manifest = require('./health_manifest').getManifest();
 *
 *   // In a component's constructor:
 *   manifest.register('TokenVault', { critical: true });
 *
 *   // When the component becomes healthy:
 *   manifest.setHealthy('TokenVault', 'Vault sealed and ready.');
 *
 *   // On fault detection:
 *   manifest.setFaulted('TokenVault', 'Decryption failure.', { errorCode: 'E_DECRYPT' });
 *
 *   // For external monitoring or healer consumption:
 *   const snap = manifest.snapshot();
 */
class KlynHealthManifest {

  constructor() {
    /**
     * Internal component registry.
     * @type {Map<string, ComponentRecord>}
     */
    this._components = new Map();

    /**
     * Kernel boot time. Used to compute uptime.
     * @type {number}
     */
    this._bootTime = Date.now();

    /**
     * Monotonic version counter, incremented on every status change.
     * Allows consumers to detect manifest changes via polling.
     * @type {number}
     */
    this._version = 0;

    log.info('Health manifest initialized.', { bootTime: this._bootTime });
  }

  // ---------------------------------------------------------------------------
  // REGISTRATION
  // ---------------------------------------------------------------------------

  /**
   * Registers a component with the manifest.
   * Idempotent: re-registering an existing component updates its metadata
   * but does not reset its status or fault count (supports hot reloads).
   *
   * @param {string}  componentId
   * @param {object}  [options]
   * @param {boolean} [options.critical=false]
   * @param {object}  [options.metadata]
   */
  register(componentId, options = {}) {
    if (this._components.has(componentId)) {
      // Update metadata only on re-registration.
      const existing = this._components.get(componentId);
      existing.metadata = { ...existing.metadata, ...(options.metadata ?? {}) };
      log.debug('Component re-registered. Metadata updated.', { componentId });
      return;
    }

    const record = new ComponentRecord(componentId, options);
    this._components.set(componentId, record);
    this._version += 1;

    log.info('Component registered.', {
      componentId,
      critical: record.critical,
    });
  }

  // ---------------------------------------------------------------------------
  // STATUS UPDATE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Marks a component as HEALTHY.
   * @param {string} componentId
   * @param {string} [detail]      Human-readable status description.
   * @param {object} [metrics]     Current performance or health metrics.
   */
  setHealthy(componentId, detail = 'Operating normally.', metrics = {}) {
    const record = this._getRecord(componentId);
    if (!record) return;

    const previous = record.status;
    record.status        = COMPONENT_STATUS.HEALTHY;
    record.statusDetail  = detail;
    record.updatedAt     = Date.now();
    record.lastHealthyAt = Date.now();
    record.metrics       = metrics;
    this._version       += 1;

    if (previous !== COMPONENT_STATUS.HEALTHY) {
      log.info('Component transitioned to HEALTHY.', {
        componentId,
        previous,
        detail,
      });
    }
  }

  /**
   * Marks a component as DEGRADED (operational with reduced capability).
   * @param {string} componentId
   * @param {string} [detail]
   * @param {object} [metrics]
   */
  setDegraded(componentId, detail = 'Operating in degraded mode.', metrics = {}) {
    const record = this._getRecord(componentId);
    if (!record) return;

    record.status       = COMPONENT_STATUS.DEGRADED;
    record.statusDetail = detail;
    record.updatedAt    = Date.now();
    record.metrics      = metrics;
    this._version      += 1;

    log.warn('Component transitioned to DEGRADED.', {
      componentId,
      critical: record.critical,
      detail,
    });
  }

  /**
   * Marks a component as FAULTED and records fault metadata.
   * @param {string} componentId
   * @param {string} [detail]
   * @param {object} [faultData]   Structured data about the fault.
   */
  setFaulted(componentId, detail = 'Component has faulted.', faultData = {}) {
    const record = this._getRecord(componentId);
    if (!record) return;

    record.status       = COMPONENT_STATUS.FAULTED;
    record.statusDetail = detail;
    record.updatedAt    = Date.now();
    record.faultCount  += 1;
    record.lastFault    = {
      detail,
      data:       faultData,
      occurredAt: Date.now(),
      correlId:   faultData.correlId || generateCorrelationId(),
    };
    this._version      += 1;

    log.error('Component transitioned to FAULTED.', {
      componentId,
      critical:   record.critical,
      faultCount: record.faultCount,
      detail,
      faultData,
    });
  }

  /**
   * Marks a component as TERMINATED (intentionally stopped).
   * @param {string} componentId
   * @param {string} [detail]
   */
  setTerminated(componentId, detail = 'Component terminated.') {
    const record = this._getRecord(componentId);
    if (!record) return;

    record.status       = COMPONENT_STATUS.TERMINATED;
    record.statusDetail = detail;
    record.updatedAt    = Date.now();
    this._version      += 1;

    log.info('Component transitioned to TERMINATED.', { componentId, detail });
  }

  /**
   * Updates a component's metrics without changing its status.
   * Useful for periodic metric refreshes (memory, latency, queue depth).
   *
   * @param {string} componentId
   * @param {object} metrics
   */
  updateMetrics(componentId, metrics) {
    const record = this._getRecord(componentId);
    if (!record) return;

    record.metrics   = { ...record.metrics, ...metrics };
    record.updatedAt = Date.now();
    // Metric updates do not increment the version counter to avoid
    // triggering unnecessary reconciliation cycles in the healer.
  }

  // ---------------------------------------------------------------------------
  // QUERY METHODS
  // ---------------------------------------------------------------------------

  /**
   * Returns the current status of a single component.
   * @param {string} componentId
   * @returns {string|null}  Status string or null if not registered.
   */
  getStatus(componentId) {
    return this._components.get(componentId)?.status ?? null;
  }

  /**
   * Returns true if all registered critical components are HEALTHY.
   * @returns {boolean}
   */
  isCriticalHealthy() {
    for (const record of this._components.values()) {
      if (record.critical && record.status !== COMPONENT_STATUS.HEALTHY) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns an array of component IDs currently in FAULTED state.
   * @returns {string[]}
   */
  getFaultedComponents() {
    return [...this._components.values()]
      .filter(r => r.status === COMPONENT_STATUS.FAULTED)
      .map(r => r.componentId);
  }

  // ---------------------------------------------------------------------------
  // SNAPSHOT (External Consumption)
  // ---------------------------------------------------------------------------

  /**
   * Produces a complete, serializable snapshot of the manifest.
   * This is the method called by the healer and the status endpoint.
   * It is synchronous and performs no I/O.
   *
   * @returns {object}
   */
  snapshot() {
    const components = {};
    for (const [id, record] of this._components) {
      components[id] = record.snapshot();
    }

    return {
      systemHealth:  this._computeSystemHealth(),
      version:       this._version,
      uptimeMs:      Date.now() - this._bootTime,
      bootTime:      this._bootTime,
      snapshotAt:    Date.now(),
      componentCount: this._components.size,
      components,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a component record by ID with a warning on miss.
   * @param {string} componentId
   * @returns {ComponentRecord|null}
   */
  _getRecord(componentId) {
    const record = this._components.get(componentId);
    if (!record) {
      log.warn('Status update for unknown component. Register first.', {
        componentId,
      });
      return null;
    }
    return record;
  }

  /**
   * Derives the system-level health summary from all component statuses.
   * @returns {string}  One of SYSTEM_HEALTH values.
   */
  _computeSystemHealth() {
    let hasFaultedCritical  = false;
    let hasDegradedCritical = false;
    let hasInitializing     = false;

    for (const record of this._components.values()) {
      if (record.status === COMPONENT_STATUS.INITIALIZING) {
        hasInitializing = true;
      }
      if (record.critical) {
        if (record.status === COMPONENT_STATUS.FAULTED) {
          hasFaultedCritical = true;
        } else if (record.status === COMPONENT_STATUS.DEGRADED) {
          hasDegradedCritical = true;
        }
      }
    }

    if (hasFaultedCritical)  return SYSTEM_HEALTH.CRITICAL;
    if (hasDegradedCritical) return SYSTEM_HEALTH.DEGRADED;
    if (hasInitializing)     return SYSTEM_HEALTH.BOOTING;
    return SYSTEM_HEALTH.HEALTHY;
  }
}

// =============================================================================
// SECTION 4: SINGLETON PATTERN
// =============================================================================

/**
 * The single global manifest instance for the kernel process.
 * All kernel modules import this singleton to register and update their state.
 * A new instance is created fresh on each kernel process start.
 *
 * @type {KlynHealthManifest}
 */
let _instance = null;

/**
 * Returns the global manifest singleton.
 * Creates the instance on first call.
 * @returns {KlynHealthManifest}
 */
function getManifest() {
  if (!_instance) {
    _instance = new KlynHealthManifest();
  }
  return _instance;
}

/**
 * Resets the singleton. For use in test suites only.
 * Calling this in production code will destroy the manifest state.
 */
function _resetManifestForTesting() {
  _instance = null;
}

// =============================================================================
// SECTION 5: EXPORTS
// =============================================================================

module.exports = Object.freeze({
  getManifest,
  COMPONENT_STATUS,
  SYSTEM_HEALTH,
  _resetManifestForTesting,
});
