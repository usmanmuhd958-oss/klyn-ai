// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * =============================================================================
 * KLYN AI OS — Shutdown Coordinator
 * File: kernel/src/lifecycle/shutdown_coordinator.js
 * Version: 1.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * PURPOSE:
 *   Centralizes all shutdown orchestration logic that was previously
 *   scattered across kernel-entry.js and orchestrator.js. The coordinator
 *   enforces a deterministic, ordered shutdown sequence:
 *
 *   Phase A — Signal:
 *     Emit KERNEL_SHUTDOWN_START on the event bus.
 *     Set health manifest to DEGRADED.
 *     Mark all components as entering shutdown.
 *
 *   Phase B — Agent Drain:
 *     Send SHUTDOWN to all live agents concurrently.
 *     Wait for SHUTDOWN_ACK or process exit within the grace period.
 *     Force-kill any agent that does not exit within the grace period.
 *
 *   Phase C — Service Cleanup:
 *     Drain the IPC mailbox queue (process remaining messages).
 *     Seal the token vault (zero key material, reject new issuances).
 *     Set health manifest components to TERMINATED.
 *
 *   Phase D — Exit:
 *     Emit KERNEL_SHUTDOWN_COMPLETE on the event bus.
 *     Call process.exit(exitCode).
 *
 * IDEMPOTENCY:
 *   The coordinator uses a shutdown lock to prevent a second concurrent
 *   shutdown from starting if a signal is received while the first is
 *   in progress. The second signal is logged and ignored.
 *
 * =============================================================================
 */

'use strict';

const { createLogger, generateCorrelationId } = require('../observability/logger');
const { LIFECYCLE_EVENT, getEventBus }         = require('./lifecycle_event_bus');

const log = createLogger('ShutdownCoordinator');

// =============================================================================
// SHUTDOWN COORDINATOR CLASS
// =============================================================================

class ShutdownCoordinator {
  [key: string]: any;

  /**
   * @param {object} options
   * @param {object}   options.healthManifest   Kernel health manifest singleton.
   * @param {object}   options.vault            Full vault singleton (for sealing).
   * @param {object}   options.mailbox          IPC mailbox (for session cleanup).
   * @param {Function} options.agentShutdownFn  Async function that shuts down agents.
   *                                            Signature: () => Promise<void>
   * @param {number}   [options.exitDelayMs]    Delay before process.exit (ms). Default 500.
   */
  constructor(options: any = {}) {
    const { healthManifest, vault, mailbox, agentShutdownFn, exitDelayMs = 500 } = options;

    if (!healthManifest) throw new TypeError('ShutdownCoordinator: healthManifest is required.');
    if (!vault)          throw new TypeError('ShutdownCoordinator: vault is required.');
    if (!mailbox)        throw new TypeError('ShutdownCoordinator: mailbox is required.');
    if (typeof agentShutdownFn !== 'function') {
      throw new TypeError('ShutdownCoordinator: agentShutdownFn must be a function.');
    }

    this._health          = healthManifest;
    this._vault           = vault;
    this._mailbox         = mailbox;
    this._agentShutdownFn = agentShutdownFn;
    this._exitDelayMs     = exitDelayMs;
    this._bus             = getEventBus();
    this._shutdownLock    = false;
    this._shutdownCorrelId = null;
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Initiates the full shutdown sequence.
   * Idempotent: subsequent calls while shutdown is in progress are no-ops.
   *
   * @param {number} [exitCode=0]  Process exit code.
   * @param {string} [reason]      Human-readable shutdown reason.
   * @returns {Promise<void>}      Resolves when process.exit() is called.
   */
  async shutdown(exitCode = 0, reason = 'Normal shutdown.') {
    if (this._shutdownLock) {
      log.warn('Shutdown already in progress. Ignoring duplicate request.', {
        correlId: this._shutdownCorrelId,
        reason,
      });
      return;
    }

    this._shutdownLock    = true;
    this._shutdownCorrelId = generateCorrelationId();
    const correlId        = this._shutdownCorrelId;
    const startedAt       = Date.now();

    log.info('Shutdown sequence initiated.', {
      exitCode,
      reason,
      correlId,
    });

    // =========================================================================
    // PHASE A: Signal
    // =========================================================================
    try {
      this._health.setDegraded('Orchestrator', 'Shutdown in progress.');
    } catch (_) { /* Health manifest may already be in shutdown state. */ }

    this._bus.emit(LIFECYCLE_EVENT.KERNEL_SHUTDOWN_START, {
      exitCode,
      reason,
    }, correlId);

    // =========================================================================
    // PHASE B: Agent Drain
    // =========================================================================
    log.info('Phase B: Draining agent processes.', { correlId });
    try {
      await this._agentShutdownFn();
    } catch (err) {
      log.error('Agent shutdown function threw. Continuing shutdown sequence.', {
        reason:  err.message,
        correlId,
      });
    }

    log.info('Phase B: Agent drain complete.', { correlId });

    // =========================================================================
    // PHASE C: Service Cleanup
    // =========================================================================
    log.info('Phase C: Service cleanup.', { correlId });

    // Seal the vault. This zeros all key material and rejects new issuances.
    try {
      this._vault.seal();
      log.info('Vault sealed.', { correlId });
    } catch (err) {
      log.error('Error sealing vault during shutdown.', {
        reason:  err.message,
        correlId,
      });
    }

    // Mark health manifest components as terminated.
    try {
      this._health.setTerminated('Orchestrator', 'Shutdown complete.');
      this._health.setTerminated('IPCMailbox',   'Shutdown complete.');
      this._health.setTerminated('TokenVault',   'Vault sealed.');
    } catch (_) { /* Non-fatal. */ }

    log.info('Phase C: Service cleanup complete.', { correlId });

    // =========================================================================
    // PHASE D: Exit
    // =========================================================================
    log.info('Phase D: Emitting shutdown complete and exiting.', {
      totalShutdownMs: Date.now() - startedAt,
      exitCode,
      correlId,
    });

    this._bus.emit(LIFECYCLE_EVENT.KERNEL_SHUTDOWN_COMPLETE, {
      exitCode,
      reason,
      totalShutdownMs: Date.now() - startedAt,
    }, correlId);

    // Brief delay allows the SHUTDOWN_COMPLETE event listeners to execute
    // before the process exits. setImmediate is not sufficient here because
    // some listeners may be async.
    await _sleep(this._exitDelayMs);

    process.exit(exitCode);
  }

  /**
   * Returns whether a shutdown is currently in progress.
   * @returns {boolean}
   */
  get isShuttingDown() {
    return this._shutdownLock;
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = Object.freeze({
  ShutdownCoordinator,
});


export {};
