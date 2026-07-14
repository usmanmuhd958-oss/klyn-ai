/**
 * =============================================================================
 * KLYN AI OS — Kernel State Machine
 * File: kernel/src/lifecycle/kernel_state_machine.js
 * Version: 1.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * PURPOSE:
 *   Provides a deterministic, validated state machine for kernel-level and
 *   agent-level lifecycle state tracking. Replaces the informal string
 *   assignments used in previous phases with a formally verified transition
 *   system that rejects illegal state progressions at development time.
 *
 * DESIGN:
 *   - Each state machine instance has a current state and a transition table.
 *   - Transitions are defined as a map: { fromState → Set<validNextStates> }.
 *   - Attempting an invalid transition throws an error rather than silently
 *     succeeding, making lifecycle bugs immediately visible.
 *   - Every transition is timestamped and recorded in a transition history
 *     for diagnostic and healer consumption.
 *   - State machines emit no events themselves — callers are responsible for
 *     publishing transitions to the lifecycle event bus.
 *
 * =============================================================================
 */

'use strict';

const { createLogger } = require('../observability/logger');

const log = createLogger('KernelStateMachine');

// =============================================================================
// SECTION 1: STATE DEFINITIONS
// =============================================================================

/**
 * Valid kernel-level states.
 * @enum {string}
 */
const KERNEL_STATE = Object.freeze({
  CONSTRUCTED:        'CONSTRUCTED',
  BOOTING:            'BOOTING',
  READY:              'READY',
  DEGRADED:           'DEGRADED',
  SHUTTING_DOWN:      'SHUTTING_DOWN',
  SHUTDOWN_COMPLETE:  'SHUTDOWN_COMPLETE',
  FAULTED:            'FAULTED',
});

/**
 * Valid agent-level states.
 * @enum {string}
 */
const AGENT_STATE = Object.freeze({
  PENDING:        'PENDING',
  SPAWNING:       'SPAWNING',
  ONLINE:         'ONLINE',
  INITIALIZING:   'INITIALIZING',
  READY:          'READY',
  DEGRADED:       'DEGRADED',
  FAULTED:        'FAULTED',
  SHUTTING_DOWN:  'SHUTTING_DOWN',
  TERMINATED:     'TERMINATED',
});

// =============================================================================
// SECTION 2: TRANSITION TABLES
// =============================================================================

/**
 * Kernel state transition table.
 * Key: current state. Value: Set of valid next states.
 * @type {Object.<string, Set<string>>}
 */
const KERNEL_TRANSITIONS = Object.freeze({
  [KERNEL_STATE.CONSTRUCTED]:  new Set([
    KERNEL_STATE.BOOTING,
    KERNEL_STATE.FAULTED,
  ]),
  [KERNEL_STATE.BOOTING]: new Set([
    KERNEL_STATE.READY,
    KERNEL_STATE.DEGRADED,
    KERNEL_STATE.FAULTED,
    KERNEL_STATE.SHUTTING_DOWN,
  ]),
  [KERNEL_STATE.READY]: new Set([
    KERNEL_STATE.DEGRADED,
    KERNEL_STATE.FAULTED,
    KERNEL_STATE.SHUTTING_DOWN,
  ]),
  [KERNEL_STATE.DEGRADED]: new Set([
    KERNEL_STATE.READY,
    KERNEL_STATE.FAULTED,
    KERNEL_STATE.SHUTTING_DOWN,
  ]),
  [KERNEL_STATE.FAULTED]: new Set([
    KERNEL_STATE.SHUTTING_DOWN,
    KERNEL_STATE.BOOTING,   // Allows recovery attempt.
  ]),
  [KERNEL_STATE.SHUTTING_DOWN]: new Set([
    KERNEL_STATE.SHUTDOWN_COMPLETE,
  ]),
  [KERNEL_STATE.SHUTDOWN_COMPLETE]: new Set([
    // Terminal state. No valid transitions.
  ]),
});

/**
 * Agent state transition table.
 * @type {Object.<string, Set<string>>}
 */
const AGENT_TRANSITIONS = Object.freeze({
  [AGENT_STATE.PENDING]: new Set([
    AGENT_STATE.SPAWNING,
    AGENT_STATE.FAULTED,
  ]),
  [AGENT_STATE.SPAWNING]: new Set([
    AGENT_STATE.ONLINE,
    AGENT_STATE.FAULTED,
    AGENT_STATE.TERMINATED,
  ]),
  [AGENT_STATE.ONLINE]: new Set([
    AGENT_STATE.INITIALIZING,
    AGENT_STATE.FAULTED,
    AGENT_STATE.TERMINATED,
  ]),
  [AGENT_STATE.INITIALIZING]: new Set([
    AGENT_STATE.READY,
    AGENT_STATE.FAULTED,
    AGENT_STATE.TERMINATED,
  ]),
  [AGENT_STATE.READY]: new Set([
    AGENT_STATE.DEGRADED,
    AGENT_STATE.FAULTED,
    AGENT_STATE.SHUTTING_DOWN,
    AGENT_STATE.TERMINATED,
  ]),
  [AGENT_STATE.DEGRADED]: new Set([
    AGENT_STATE.READY,
    AGENT_STATE.FAULTED,
    AGENT_STATE.SHUTTING_DOWN,
    AGENT_STATE.TERMINATED,
  ]),
  [AGENT_STATE.FAULTED]: new Set([
    AGENT_STATE.SPAWNING,    // Allows retry via re-spawn.
    AGENT_STATE.TERMINATED,
    AGENT_STATE.SHUTTING_DOWN,
  ]),
  [AGENT_STATE.SHUTTING_DOWN]: new Set([
    AGENT_STATE.TERMINATED,
  ]),
  [AGENT_STATE.TERMINATED]: new Set([
    AGENT_STATE.SPAWNING,    // Allows restart after termination.
  ]),
});

// =============================================================================
// SECTION 3: STATE MACHINE CLASS
// =============================================================================

/**
 * KlynStateMachine — A validated, history-recording state machine.
 *
 * Usage:
 *   const sm = new KlynStateMachine({
 *     id:            'kernel',
 *     initialState:  KERNEL_STATE.CONSTRUCTED,
 *     transitions:   KERNEL_TRANSITIONS,
 *   });
 *
 *   sm.transition(KERNEL_STATE.BOOTING, 'Boot sequence starting.');
 *   sm.transition(KERNEL_STATE.READY, 'All agents operational.');
 *
 *   console.log(sm.current); // 'READY'
 *   console.log(sm.history); // [{ from, to, reason, ts }, ...]
 */
class KlynStateMachine {

  /**
   * @param {object} options
   * @param {string}              options.id            Identifier for this machine (logging).
   * @param {string}              options.initialState  Starting state.
   * @param {Object.<string, Set<string>>} options.transitions  Transition table.
   * @param {number}              [options.maxHistory]  Max history entries. Default 100.
   */
  constructor(options) {
    const { id, initialState, transitions, maxHistory = 100 } = options;

    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TypeError('KlynStateMachine: id must be a non-empty string.');
    }
    if (typeof initialState !== 'string') {
      throw new TypeError('KlynStateMachine: initialState must be a string.');
    }
    if (typeof transitions !== 'object' || transitions === null) {
      throw new TypeError('KlynStateMachine: transitions must be a plain object.');
    }
    if (!(initialState in transitions)) {
      throw new RangeError(
        `KlynStateMachine: initialState "${initialState}" is not in the transition table.`
      );
    }

    this._id          = id;
    this._current     = initialState;
    this._transitions = transitions;
    this._maxHistory  = maxHistory;
    this._history     = [];
    this._createdAt   = Date.now();

    // Record the initial state as the first history entry.
    this._history.push({
      from:   null,
      to:     initialState,
      reason: 'Initial state.',
      ts:     this._createdAt,
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * The current state string.
   * @type {string}
   */
  get current() {
    return this._current;
  }

  /**
   * True if the machine is in a terminal state (no valid outgoing transitions).
   * @type {boolean}
   */
  get isTerminal() {
    const validNext = this._transitions[this._current];
    return !validNext || validNext.size === 0;
  }

  /**
   * The full transition history, most recent last.
   * @type {Array<{ from: string|null, to: string, reason: string, ts: number }>}
   */
  get history() {
    return [...this._history];
  }

  /**
   * The most recent transition record.
   * @type {{ from: string|null, to: string, reason: string, ts: number }}
   */
  get lastTransition() {
    return this._history[this._history.length - 1] ?? null;
  }

  /**
   * Attempts a state transition.
   * Throws if the transition is not valid according to the transition table.
   *
   * @param {string} nextState  The target state.
   * @param {string} [reason]   Human-readable reason for the transition.
   * @returns {{ from: string, to: string, ts: number }}  The transition record.
   * @throws {Error}  If the transition is invalid.
   */
  transition(nextState, reason = '') {
    if (this.isTerminal) {
      throw new Error(
        `KlynStateMachine [${this._id}]: Cannot transition from terminal state ` +
        `"${this._current}" to "${nextState}".`
      );
    }

    const validNext = this._transitions[this._current];

    if (!validNext || !validNext.has(nextState)) {
      const allowed = validNext ? [...validNext].join(', ') : 'none';
      throw new Error(
        `KlynStateMachine [${this._id}]: Invalid transition ` +
        `"${this._current}" → "${nextState}". ` +
        `Allowed transitions from "${this._current}": [${allowed}].`
      );
    }

    const from = this._current;
    this._current = nextState;

    const record = {
      from,
      to:     nextState,
      reason: reason || `Transitioned from ${from} to ${nextState}.`,
      ts:     Date.now(),
    };

    // Maintain bounded history.
    if (this._history.length >= this._maxHistory) {
      this._history.shift();
    }
    this._history.push(record);

    log.debug('State transition.', {
      machineId: this._id,
      from,
      to:        nextState,
      reason:    record.reason,
    });

    return record;
  }

  /**
   * Returns whether a specific next state is reachable from the current state.
   * @param {string} nextState
   * @returns {boolean}
   */
  canTransitionTo(nextState) {
    if (this.isTerminal) return false;
    const validNext = this._transitions[this._current];
    return validNext ? validNext.has(nextState) : false;
  }

  /**
   * Returns all valid next states from the current state.
   * @returns {string[]}
   */
  validNextStates() {
    if (this.isTerminal) return [];
    const validNext = this._transitions[this._current];
    return validNext ? [...validNext] : [];
  }

  /**
   * Produces a serializable snapshot for logging and diagnostic endpoints.
   * @returns {object}
   */
  snapshot() {
    return {
      id:              this._id,
      current:         this._current,
      isTerminal:      this.isTerminal,
      validNextStates: this.validNextStates(),
      transitionCount: this._history.length - 1,
      createdAt:       this._createdAt,
      lastTransition:  this.lastTransition,
    };
  }
}

// =============================================================================
// SECTION 4: FACTORY FUNCTIONS
// =============================================================================

/**
 * Creates a kernel-level state machine starting at CONSTRUCTED.
 * @param {string} kernelId  Used as the machine ID.
 * @returns {KlynStateMachine}
 */
function createKernelStateMachine(kernelId) {
  return new KlynStateMachine({
    id:           `kernel:${kernelId}`,
    initialState: KERNEL_STATE.CONSTRUCTED,
    transitions:  KERNEL_TRANSITIONS,
  });
}

/**
 * Creates an agent-level state machine starting at PENDING.
 * @param {string} agentId  Used as the machine ID.
 * @returns {KlynStateMachine}
 */
function createAgentStateMachine(agentId) {
  return new KlynStateMachine({
    id:           `agent:${agentId}`,
    initialState: AGENT_STATE.PENDING,
    transitions:  AGENT_TRANSITIONS,
  });
}

// =============================================================================
// SECTION 5: EXPORTS
// =============================================================================

module.exports = Object.freeze({
  KlynStateMachine,
  KERNEL_STATE,
  AGENT_STATE,
  KERNEL_TRANSITIONS,
  AGENT_TRANSITIONS,
  createKernelStateMachine,
  createAgentStateMachine,
});
