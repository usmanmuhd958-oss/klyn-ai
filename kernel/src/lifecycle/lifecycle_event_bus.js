/**
 * =============================================================================
 * KLYN AI OS — Kernel Lifecycle Event Bus
 * File: kernel/src/lifecycle/lifecycle_event_bus.js
 * Version: 1.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * PURPOSE:
 *   The Lifecycle Event Bus is the formal event publication system for all
 *   kernel-level state transitions. It decouples the Orchestrator from the
 *   components that observe its state (healer, monitoring, status endpoints,
 *   collaboration layer).
 *
 * DESIGN PRINCIPLES:
 *
 *   1. FIRE-AND-FORGET FROM THE ORCHESTRATOR'S PERSPECTIVE:
 *      The Orchestrator emits events and does not await listener responses.
 *      The bus handles listener errors in isolation — a failing listener
 *      never propagates an exception back to the Orchestrator.
 *
 *   2. CIRCUIT BREAKER ON THE BUS ITSELF:
 *      If a listener fails repeatedly (exceeds MAX_LISTENER_FAILURES within
 *      the failure window), the bus removes that listener and marks it as
 *      failed. The kernel continues operating. The bus does not become a
 *      single point of failure.
 *
 *   3. STRUCTURED EVENT SCHEMA:
 *      Every event is a plain object with a fixed schema: type, correlId,
 *      ts, payload. Listeners can always rely on this structure.
 *
 *   4. EVENT HISTORY BUFFER:
 *      The bus maintains a bounded circular buffer of recent events.
 *      The healer and status endpoint can read this buffer to reconstruct
 *      the sequence of state transitions without subscribing to events
 *      in real time.
 *
 *   5. KERNEL INDIFFERENCE TO BUS HEALTH:
 *      The kernel's operational continuity does not depend on the bus being
 *      fully healthy. If all listeners fail, the bus continues accepting
 *      events (they are recorded in the history buffer). The kernel never
 *      awaits the bus.
 *
 * =============================================================================
 */

'use strict';

const { createLogger, generateCorrelationId } = require('../observability/logger');

const log = createLogger('LifecycleEventBus');

// =============================================================================
// SECTION 1: EVENT TYPE REGISTRY
// =============================================================================

/**
 * All valid lifecycle event types. Closed enumeration.
 * Adding a new event type requires adding it here first.
 * @enum {string}
 */
const LIFECYCLE_EVENT = Object.freeze({
  // Kernel-level events
  KERNEL_BOOTING:          'kernel:booting',
  KERNEL_READY:            'kernel:ready',
  KERNEL_SHUTDOWN_START:   'kernel:shutdown:start',
  KERNEL_SHUTDOWN_COMPLETE:'kernel:shutdown:complete',
  KERNEL_FAULT:            'kernel:fault',

  // Agent lifecycle events
  AGENT_SPAWNING:          'agent:spawning',
  AGENT_ONLINE:            'agent:online',
  AGENT_INITIALIZING:      'agent:initializing',
  AGENT_READY:             'agent:ready',
  AGENT_SHUTTING_DOWN:     'agent:shutting_down',
  AGENT_TERMINATED:        'agent:terminated',
  AGENT_FAULTED:           'agent:faulted',
  AGENT_RECOVERED:         'agent:recovered',

  // Task lifecycle events
  TASK_DISPATCHED:         'task:dispatched',
  TASK_COMPLETED:          'task:completed',
  TASK_FAILED:             'task:failed',
  TASK_CANCELLED:          'task:cancelled',
  TASK_PROGRESS:           'task:progress',

  // Security events
  TOKEN_ISSUED:            'token:issued',
  TOKEN_VERIFIED:          'token:verified',
  TOKEN_REJECTED:          'token:rejected',
  IPC_MESSAGE_REJECTED:    'ipc:message:rejected',
  IPC_SESSION_REGISTERED:  'ipc:session:registered',
  IPC_SESSION_REMOVED:     'ipc:session:removed',
});

const VALID_EVENT_TYPES = new Set(Object.values(LIFECYCLE_EVENT));

// =============================================================================
// SECTION 2: CONFIGURATION
// =============================================================================

const BUS_CONFIG = Object.freeze({
  /** Maximum number of events retained in the history buffer. */
  HISTORY_CAPACITY:           500,

  /** Maximum consecutive failures before a listener is auto-removed. */
  MAX_LISTENER_FAILURES:      5,

  /** Time window (ms) in which failures are counted against the threshold. */
  LISTENER_FAILURE_WINDOW_MS: 60_000,

  /** Maximum number of registered listeners per event type. */
  MAX_LISTENERS_PER_EVENT:    20,
});

// =============================================================================
// SECTION 3: LISTENER RECORD
// =============================================================================

/**
 * Tracks a single event listener's runtime state.
 */
class ListenerRecord {
  /**
   * @param {string}   eventType
   * @param {Function} fn        The listener callback.
   * @param {object}   [options]
   * @param {boolean}  [options.once]   Auto-remove after first call.
   * @param {string}   [options.name]   Descriptive name for logging.
   */
  constructor(eventType, fn, options = {}) {
    this.id          = _generateListenerId();
    this.eventType   = eventType;
    this.fn          = fn;
    this.once        = options.once  ?? false;
    this.name        = options.name ?? (fn.name || 'anonymous');
    this.callCount   = 0;
    this.errorCount  = 0;
    this.lastErrorAt = null;
    this.createdAt   = Date.now();
    this.active      = true;
  }

  /**
   * Returns true if this listener has exceeded its failure threshold
   * within the failure window and should be removed.
   * @returns {boolean}
   */
  isCircuitOpen() {
    if (this.errorCount < BUS_CONFIG.MAX_LISTENER_FAILURES) return false;
    if (!this.lastErrorAt) return false;
    return (Date.now() - this.lastErrorAt) < BUS_CONFIG.LISTENER_FAILURE_WINDOW_MS;
  }
}

let _listenerIdCounter = 0;
function _generateListenerId() {
  return `listener_${++_listenerIdCounter}`;
}

// =============================================================================
// SECTION 4: LIFECYCLE EVENT CLASS
// =============================================================================

/**
 * Represents a structured lifecycle event.
 */
class LifecycleEvent {
  /**
   * @param {string} type     One of LIFECYCLE_EVENT values.
   * @param {object} payload  Event-specific data.
   * @param {string} [correlId]
   */
  constructor(type, payload, correlId) {
    this.type     = type;
    this.payload  = Object.freeze(payload ?? {});
    this.correlId = correlId || generateCorrelationId();
    this.ts       = Date.now();

    Object.freeze(this);
  }
}

// =============================================================================
// SECTION 5: LIFECYCLE EVENT BUS CLASS
// =============================================================================

/**
 * KlynLifecycleEventBus — Decoupled event publication for kernel lifecycle transitions.
 *
 * Usage:
 *   const bus = new KlynLifecycleEventBus();
 *
 *   // Publisher (Orchestrator):
 *   bus.emit(LIFECYCLE_EVENT.AGENT_READY, { agentId: 'bug_hunter' }, correlId);
 *
 *   // Subscriber (Healer):
 *   bus.on(LIFECYCLE_EVENT.AGENT_FAULTED, ({ payload, correlId }) => {
 *     // Handle fault.
 *   }, { name: 'HealerFaultHandler' });
 *
 *   // Read recent history:
 *   const history = bus.getHistory(LIFECYCLE_EVENT.AGENT_FAULTED, 10);
 */
class KlynLifecycleEventBus {

  constructor() {
    /**
     * Listener registry. eventType → ListenerRecord[].
     * @type {Map<string, ListenerRecord[]>}
     */
    this._listeners = new Map();

    /**
     * Circular event history buffer.
     * @type {LifecycleEvent[]}
     */
    this._history = [];

    /**
     * Total events emitted since construction.
     * @type {number}
     */
    this._emitCount = 0;

    log.info('Lifecycle Event Bus initialized.', {
      historyCapacity: BUS_CONFIG.HISTORY_CAPACITY,
      maxListeners:    BUS_CONFIG.MAX_LISTENERS_PER_EVENT,
    });
  }

  // ---------------------------------------------------------------------------
  // SUBSCRIPTION
  // ---------------------------------------------------------------------------

  /**
   * Subscribes a listener to a lifecycle event type.
   *
   * @param {string}   eventType  One of LIFECYCLE_EVENT values.
   * @param {Function} fn         Listener callback (event: LifecycleEvent) => void.
   * @param {object}   [options]
   * @param {boolean}  [options.once]  Remove after first invocation.
   * @param {string}   [options.name]  Descriptive name for error logging.
   * @returns {string}  Listener ID. Pass to off() to unsubscribe.
   * @throws {TypeError}  On invalid eventType or fn.
   */
  on(eventType, fn, options = {}) {
    this._assertValidEventType(eventType);

    if (typeof fn !== 'function') {
      throw new TypeError(
        `LifecycleEventBus.on: listener must be a function, received ${typeof fn}.`
      );
    }

    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, []);
    }

    const listeners = this._listeners.get(eventType);

    if (listeners.length >= BUS_CONFIG.MAX_LISTENERS_PER_EVENT) {
      throw new RangeError(
        `LifecycleEventBus: Maximum listener limit (${BUS_CONFIG.MAX_LISTENERS_PER_EVENT}) ` +
        `reached for event type "${eventType}".`
      );
    }

    const record = new ListenerRecord(eventType, fn, options);
    listeners.push(record);

    log.debug('Listener registered.', {
      listenerId: record.id,
      eventType,
      name:       record.name,
      once:       record.once,
    });

    return record.id;
  }

  /**
   * Subscribes a listener that auto-removes after its first invocation.
   * @param {string}   eventType
   * @param {Function} fn
   * @param {object}   [options]
   * @returns {string}  Listener ID.
   */
  once(eventType, fn, options = {}) {
    return this.on(eventType, fn, { ...options, once: true });
  }

  /**
   * Removes a listener by its ID.
   * @param {string} listenerId  The ID returned by on() or once().
   * @returns {boolean}  True if the listener was found and removed.
   */
  off(listenerId) {
    for (const [eventType, listeners] of this._listeners) {
      const index = listeners.findIndex(r => r.id === listenerId);
      if (index !== -1) {
        listeners.splice(index, 1);
        log.debug('Listener removed.', { listenerId, eventType });
        return true;
      }
    }
    log.warn('off() called with unknown listenerId.', { listenerId });
    return false;
  }

  /**
   * Removes all listeners for a specific event type.
   * @param {string} eventType
   */
  removeAllListeners(eventType) {
    if (eventType) {
      this._listeners.delete(eventType);
      log.debug('All listeners removed for event type.', { eventType });
    } else {
      this._listeners.clear();
      log.debug('All listeners removed for all event types.');
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLICATION
  // ---------------------------------------------------------------------------

  /**
   * Emits a lifecycle event.
   * All registered listeners are invoked synchronously but wrapped in
   * individual try/catch blocks. A listener failure never propagates
   * to the caller or prevents other listeners from executing.
   *
   * @param {string}  eventType   One of LIFECYCLE_EVENT values.
   * @param {object}  payload     Event-specific data.
   * @param {string}  [correlId]  Correlation ID for cross-component tracing.
   */
  emit(eventType, payload = {}, correlId) {
    this._assertValidEventType(eventType);

    const event = new LifecycleEvent(eventType, payload, correlId);
    this._emitCount++;

    // Record in history buffer.
    this._recordHistory(event);

    // Invoke listeners.
    const listeners = this._listeners.get(eventType);
    if (!listeners || listeners.length === 0) {
      log.debug('Event emitted with no listeners.', { eventType, correlId: event.correlId });
      return;
    }

    // Collect once-listeners that need removal after this cycle.
    const toRemove = [];

    for (const record of [...listeners]) {
      if (!record.active) continue;

      // Check circuit breaker.
      if (record.isCircuitOpen()) {
        log.warn('Listener circuit is open. Skipping.', {
          listenerId: record.id,
          name:       record.name,
          errorCount: record.errorCount,
          eventType,
        });
        continue;
      }

      try {
        record.fn(event);
        record.callCount++;

        if (record.once) {
          toRemove.push(record.id);
        }
      } catch (err) {
        record.errorCount++;
        record.lastErrorAt = Date.now();

        log.error('Listener threw an exception. Isolated from caller.', {
          listenerId: record.id,
          name:       record.name,
          eventType,
          errorCount: record.errorCount,
          reason:     err.message,
        });

        if (record.isCircuitOpen()) {
          log.warn('Listener circuit opened due to repeated failures. Auto-removing.', {
            listenerId: record.id,
            name:       record.name,
            eventType,
          });
          toRemove.push(record.id);
        }
      }
    }

    // Remove once-listeners and circuit-tripped listeners.
    for (const id of toRemove) {
      this.off(id);
    }

    log.debug('Event emitted.', {
      eventType,
      correlId:      event.correlId,
      listenerCount: listeners.length,
    });
  }

  // ---------------------------------------------------------------------------
  // HISTORY QUERY
  // ---------------------------------------------------------------------------

  /**
   * Returns recent events from the history buffer, optionally filtered by type.
   *
   * @param {string}  [eventType]  If provided, only events of this type are returned.
   * @param {number}  [limit=50]   Maximum number of events to return.
   * @returns {LifecycleEvent[]}   Most recent events first.
   */
  getHistory(eventType, limit = 50) {
    let events = [...this._history];

    if (eventType) {
      this._assertValidEventType(eventType);
      events = events.filter(e => e.type === eventType);
    }

    return events
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  /**
   * Returns the total number of events emitted since bus creation.
   * @returns {number}
   */
  getEmitCount() {
    return this._emitCount;
  }

  /**
   * Returns listener count per event type for diagnostic use.
   * @returns {object}
   */
  getListenerCounts() {
    const counts = {};
    for (const [type, listeners] of this._listeners) {
      counts[type] = listeners.filter(r => r.active).length;
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Adds an event to the circular history buffer.
   * Evicts the oldest entry when capacity is reached.
   * @param {LifecycleEvent} event
   */
  _recordHistory(event) {
    if (this._history.length >= BUS_CONFIG.HISTORY_CAPACITY) {
      this._history.shift(); // Remove oldest entry.
    }
    this._history.push(event);
  }

  /**
   * Validates that an event type string is a known LIFECYCLE_EVENT value.
   * @param {string} eventType
   * @throws {TypeError}
   */
  _assertValidEventType(eventType) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      throw new TypeError(
        `LifecycleEventBus: Unknown event type "${eventType}". ` +
        `Valid types: ${[...VALID_EVENT_TYPES].join(', ')}.`
      );
    }
  }
}

// =============================================================================
// SECTION 6: SINGLETON EXPORT
// =============================================================================

let _busInstance = null;

/**
 * Returns the global lifecycle event bus singleton.
 * Created on first call. All kernel components share this instance.
 * @returns {KlynLifecycleEventBus}
 */
function getEventBus() {
  if (!_busInstance) {
    _busInstance = new KlynLifecycleEventBus();
  }
  return _busInstance;
}

/** Resets the singleton. For use in test suites only. */
function _resetBusForTesting() {
  _busInstance = null;
}

// =============================================================================
// SECTION 7: EXPORTS
// =============================================================================

module.exports = Object.freeze({
  getEventBus,
  KlynLifecycleEventBus,
  LIFECYCLE_EVENT,
  _resetBusForTesting,
});
