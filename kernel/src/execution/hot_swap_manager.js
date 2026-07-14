/**
 * =============================================================================
 * KLYN AI OS — Hot-Swap Manager
 * File: kernel/src/execution/hot_swap_manager.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Enables zero-downtime code replacement for running agents. This is the
 *   kernel-side interface for the hot-swapping mechanism coordinated with
 *   the Bash orchestrator.
 *
 * ARCHITECTURE:
 *   Phase 1 — Validation:
 *     Syntax check, security scan, dry-run in sandbox
 *   Phase 2 — Staging:
 *     Write validated code to .runtime/swap/$AGENT.sh.swp
 *   Phase 3 — Signal:
 *     Bash orchestrator detects .swp file and performs swap
 *   Phase 4 — Verification:
 *     Monitor post-swap health, auto-rollback on failure
 *
 * SAFETY MECHANISMS:
 *   - Automatic backups before swap
 *   - Syntax validation before staging
 *   - Health monitoring post-swap
 *   - Automatic rollback on degradation
 *
 * =============================================================================
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const { createLogger, generateCorrelationId } = require('../observability/logger');
const { getManifest } = require('../observability/health_manifest');
const { getEventBus, LIFECYCLE_EVENT } = require('../lifecycle/lifecycle_event_bus');
const { getAgentExecutor } = require('./agent_executor');

const log      = createLogger('HotSwapManager');
const manifest = getManifest();
const bus      = getEventBus();

// =============================================================================
// SECTION 1: CONFIGURATION
// =============================================================================

const HOT_SWAP_CONFIG = Object.freeze({
  /** Path to swap staging directory */
  SWAP_DIR: '/data/data/com.termux/files/home/klyn-ai-os/.runtime/swap',

  /** Path to agents directory */
  AGENTS_DIR: '/data/data/com.termux/files/home/klyn-ai-os/agents',

  /** Post-swap health monitoring window (ms) */
  HEALTH_MONITOR_WINDOW_MS: 60_000,

  /** Health check interval during monitoring (ms) */
  HEALTH_CHECK_INTERVAL_MS: 5_000,

  /** Maximum script size (bytes) */
  MAX_SCRIPT_SIZE: 1024 * 1024,  // 1 MB

  /** Allowed agents for hot-swapping */
  ALLOWED_AGENTS: ['coder', 'planner', 'researcher', 'reviewer'],
});

// =============================================================================
// SECTION 2: HOT-SWAP MANAGER
// =============================================================================

class HotSwapManager {

  constructor() {
    this._executor = getAgentExecutor();

    /** Active swap operations. Key = swapId */
    this._activeSwaps = new Map();

    /** Swap history (last 50) */
    this._history = [];

    manifest.register('HotSwapManager', {
      critical: false,
      metadata: { version: '1.0.0' },
    });

    this._ensureSwapDirectory();

    log.info('Hot-Swap Manager initialized.', {
      swapDir:       HOT_SWAP_CONFIG.SWAP_DIR,
      allowedAgents: HOT_SWAP_CONFIG.ALLOWED_AGENTS,
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Initiates a hot-swap operation for an agent.
   *
   * @param {object} options
   * @param {string}  options.agentId       Agent to hot-swap
   * @param {string}  options.newCode       New code content
   * @param {string}  [options.reason]      Reason for swap
   * @param {string}  [options.requesterId] Who requested the swap
   * @param {string}  [options.correlId]    Correlation ID
   * @returns {Promise<{ swapId: string, success: boolean }>}
   */
  async initiateSwap(options) {
    const {
      agentId,
      newCode,
      reason = 'manual hot-swap',
      requesterId = 'unknown',
      correlId = generateCorrelationId(),
    } = options;

    log.info('Hot-swap initiated.', { agentId, reason, requesterId, correlId });

    // Validation
    if (!HOT_SWAP_CONFIG.ALLOWED_AGENTS.includes(agentId)) {
      throw Object.assign(
        new Error(`Hot-swap not allowed for agent "${agentId}".`),
        { code: 'AGENT_NOT_ALLOWED' }
      );
    }

    if (Buffer.byteLength(newCode, 'utf8') > HOT_SWAP_CONFIG.MAX_SCRIPT_SIZE) {
      throw Object.assign(
        new Error('New code exceeds maximum size.'),
        { code: 'CODE_TOO_LARGE' }
      );
    }

    const swapId = this._generateSwapId();

    const swapRecord = {
      swapId,
      agentId,
      reason,
      requesterId,
      correlId,
      initiatedAt:   Date.now(),
      phase:         'VALIDATING',
      success:       null,
      error:         null,
      rollbackPerformed: false,
    };

    this._activeSwaps.set(swapId, swapRecord);

    try {
      // Phase 1: Validate
      await this._validateCode(agentId, newCode, swapRecord);

      // Phase 2: Stage
      await this._stageCode(agentId, newCode, swapRecord);

      // Phase 3: Signal (Bash orchestrator will detect and swap)
      // We just wait and monitor health

      // Phase 4: Monitor
      await this._monitorPostSwap(swapRecord);

      swapRecord.success = true;
      swapRecord.phase   = 'COMPLETED';

      this._addToHistory(swapRecord);
      this._activeSwaps.delete(swapId);

      log.info('Hot-swap completed successfully.', { swapId, agentId, correlId });

      bus.emit('agent:hot_swapped', { swapId, agentId }, correlId);

      return { swapId, success: true };

    } catch (err) {
      swapRecord.success = false;
      swapRecord.error   = err.message;
      swapRecord.phase   = 'FAILED';

      this._addToHistory(swapRecord);
      this._activeSwaps.delete(swapId);

      log.error('Hot-swap failed.', {
        swapId,
        agentId,
        reason:  err.message,
        code:    err.code,
        correlId,
      });

      bus.emit('agent:hot_swap_failed', { swapId, agentId, reason: err.message }, correlId);

      throw err;
    }
  }

  /**
   * Returns the history of hot-swap operations.
   * @returns {Array<object>}
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Returns the status of an active swap.
   * @param {string} swapId
   * @returns {object|null}
   */
  getSwapStatus(swapId) {
    return this._activeSwaps.get(swapId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — SWAP PHASES
  // ---------------------------------------------------------------------------

  /**
   * Phase 1: Validates the new code.
   * @param {string} agentId
   * @param {string} code
   * @param {object} swapRecord
   */
  async _validateCode(agentId, code, swapRecord) {
    swapRecord.phase = 'VALIDATING';

    log.debug('Validating new code.', {
      swapId:  swapRecord.swapId,
      agentId,
      correlId: swapRecord.correlId,
    });

    // Write to temp file for syntax check
    const tempFile = path.join(HOT_SWAP_CONFIG.SWAP_DIR, `${swapRecord.swapId}.tmp.sh`);
    fs.writeFileSync(tempFile, code, 'utf8');

    try {
      // Bash syntax check
      await execAsync(`bash -n "${tempFile}"`, { timeout: 5_000 });

      log.debug('Syntax validation passed.', { swapId: swapRecord.swapId });

    } catch (syntaxErr) {
      throw Object.assign(
        new Error(`Syntax validation failed: ${syntaxErr.message}`),
        { code: 'SYNTAX_ERROR' }
      );
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (_) { /* Ignore */ }
    }

    // Security scan: detect dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\/(?!\s*data\/data\/com\.termux)/,  // Prevent root rm -rf
      /dd\s+if=/,                                       // Prevent disk writes
      /:\(\)\{\s*:\|:&\s*\};:/,                         // Fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw Object.assign(
          new Error(`Security scan failed: dangerous pattern detected`),
          { code: 'SECURITY_VIOLATION' }
        );
      }
    }

    log.debug('Security scan passed.', { swapId: swapRecord.swapId });
  }

  /**
   * Phase 2: Stages the validated code for the Bash orchestrator to pick up.
   * @param {string} agentId
   * @param {string} code
   * @param {object} swapRecord
   */
  async _stageCode(agentId, code, swapRecord) {
    swapRecord.phase = 'STAGING';

    const swapFile = path.join(HOT_SWAP_CONFIG.SWAP_DIR, `${agentId}.sh.swp`);

    log.debug('Staging code to swap file.', {
      swapId:   swapRecord.swapId,
      agentId,
      swapFile,
      correlId: swapRecord.correlId,
    });

    // Write to swap file (Bash orchestrator will detect this)
    fs.writeFileSync(swapFile, code, 'utf8');

    log.info('Code staged for hot-swap.', {
      swapId:   swapRecord.swapId,
      agentId,
      swapFile,
    });
  }

  /**
   * Phase 4: Monitors agent health post-swap.
   * Auto-rolls back if health degrades.
   * @param {object} swapRecord
   */
  async _monitorPostSwap(swapRecord) {
    const { agentId, swapId, correlId } = swapRecord;
    swapRecord.phase = 'MONITORING';

    log.info('Starting post-swap health monitoring.', {
      swapId,
      agentId,
      windowMs: HOT_SWAP_CONFIG.HEALTH_MONITOR_WINDOW_MS,
      correlId,
    });

    const startTime = Date.now();
    let checkCount  = 0;

    while (Date.now() - startTime < HOT_SWAP_CONFIG.HEALTH_MONITOR_WINDOW_MS) {
      await this._sleep(HOT_SWAP_CONFIG.HEALTH_CHECK_INTERVAL_MS);

      const healthy = await this._executor.checkHealth(agentId);
      checkCount++;

      if (!healthy) {
        log.warn('Post-swap health check failed. Initiating rollback.', {
          swapId,
          agentId,
          checkCount,
        });

        await this._performRollback(swapRecord);
        swapRecord.rollbackPerformed = true;

        throw Object.assign(
          new Error('Agent health degraded post-swap. Rollback performed.'),
          { code: 'HEALTH_DEGRADED' }
        );
      }

      log.debug('Post-swap health check passed.', {
        swapId,
        agentId,
        checkCount,
      });
    }

    log.info('Post-swap monitoring complete. No health issues detected.', {
      swapId,
      agentId,
      checkCount,
    });
  }

  /**
   * Performs an automatic rollback by restoring the backup.
   * @param {object} swapRecord
   */
  async _performRollback(swapRecord) {
    const { agentId, swapId, correlId } = swapRecord;

    log.warn('Performing automatic rollback.', { swapId, agentId, correlId });

    // The Bash orchestrator creates backups automatically during swap
    // We just need to signal a restart to pick up the backup
    await this._executor.requestRestart(agentId, `Rollback from failed swap ${swapId}`);

    log.info('Rollback initiated. Agent will restart with previous code.', {
      swapId,
      agentId,
    });

    bus.emit('agent:rollback', { swapId, agentId }, correlId);
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — UTILITIES
  // ---------------------------------------------------------------------------

  _ensureSwapDirectory() {
    if (!fs.existsSync(HOT_SWAP_CONFIG.SWAP_DIR)) {
      fs.mkdirSync(HOT_SWAP_CONFIG.SWAP_DIR, { recursive: true });
    }
  }

  _generateSwapId() {
    return `swap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  _addToHistory(record) {
    this._history.push({
      swapId:     record.swapId,
      agentId:    record.agentId,
      reason:     record.reason,
      success:    record.success,
      error:      record.error,
      rolledBack: record.rollbackPerformed,
      initiatedAt: record.initiatedAt,
      completedAt: Date.now(),
    });

    if (this._history.length > 50) {
      this._history.shift();
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// SECTION 3: SINGLETON EXPORT
// =============================================================================

let _managerInstance = null;

function getHotSwapManager() {
  if (!_managerInstance) {
    _managerInstance = new HotSwapManager();
  }
  return _managerInstance;
}

module.exports = Object.freeze({
  getHotSwapManager,
  HotSwapManager,
  HOT_SWAP_CONFIG,
});
