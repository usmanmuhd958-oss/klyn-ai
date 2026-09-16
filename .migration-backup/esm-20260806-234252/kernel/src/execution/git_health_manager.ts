/**
 * =============================================================================
 * KLYN AI OS — Git Health Manager
 * File: kernel/src/execution/git_health_manager.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Manages Git-based health verification and deployment workflows. When all
 *   agents are healthy, promotes code from feature/enterprise-os-core to main.
 *
 * WORKFLOW:
 *   1. Continuous development happens on feature/enterprise-os-core
 *   2. Git Health Manager monitors system health
 *   3. When health is HEALTHY for sustained period, merge to main is eligible
 *   4. Kernel signals readiness (writes merge signal file)
 *   5. Bash orchestrator performs actual merge
 *   6. Tag created, system continues on feature branch
 *
 * SAFETY MECHANISMS:
 *   - Health must be stable for configurable window
 *   - All critical agents must pass health checks
 *   - Git merge can be aborted if health degrades mid-merge
 *   - Tags created for every successful merge
 *
 * =============================================================================
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

import { createLogger, generateCorrelationId } from '../observability/logger.js';
import { getManifest, SYSTEM_HEALTH } from '../observability/health_manifest.js';
import { getEventBus, LIFECYCLE_EVENT } from '../lifecycle/lifecycle_event_bus.js';
import { getAgentExecutor } from './agent_executor.js';

const log      = createLogger('GitHealthManager');
const manifest = getManifest();
const bus      = getEventBus();

// =============================================================================
// SECTION 1: CONFIGURATION
// =============================================================================

const GIT_CONFIG = Object.freeze({
  /** KLYN root directory */
  KLYN_ROOT: (process.env.KLYN_PROJECT_ROOT || path.join(process.env.HOME || '', 'klyn-ai-os')),

  /** Runtime directory */
  RUNTIME_DIR: path.join(process.env.KLYN_PROJECT_ROOT || path.join(process.env.HOME || '', 'klyn-ai-os'), '.runtime'),

  /** Feature branch name */
  FEATURE_BRANCH: 'feature/enterprise-os-core',

  /** Main/production branch name */
  MAIN_BRANCH: 'main',

  /** Health stability window (ms) */
  HEALTH_STABILITY_WINDOW_MS: 300_000,  // 5 minutes

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL_MS: 30_000,

  /** Auto-merge enabled */
  AUTO_MERGE_ENABLED: true,
});

// =============================================================================
// SECTION 2: GIT HEALTH MANAGER
// =============================================================================

class GitHealthManager {
  [key: string]: any;

  constructor() {
    this._executor = getAgentExecutor();

    /** Track health stability */
    this._healthyStart = null;
    this._lastHealth   = null;

    /** Merge eligibility state */
    this._mergeEligible = false;

    manifest.register('GitHealthManager', {
      critical: false,
      metadata: { version: '1.0.0' },
    });

    this._verifyGitRepository();
    this._startHealthMonitor();

    log.info('Git Health Manager initialized.', {
      featureBranch: GIT_CONFIG.FEATURE_BRANCH,
      mainBranch:    GIT_CONFIG.MAIN_BRANCH,
      autoMerge:     GIT_CONFIG.AUTO_MERGE_ENABLED,
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Returns whether the system is currently merge-eligible.
   * @returns {boolean}
   */
  isMergeEligible() {
    return this._mergeEligible;
  }

  /**
   * Manually triggers a merge signal (for testing or manual promotion).
   * @returns {Promise<void>}
   */
  async triggerMerge() {
    const correlId = generateCorrelationId();

    log.info('Manual merge trigger requested.', { correlId });

    if (!this._mergeEligible) {
      throw Object.assign(
        new Error('System is not merge-eligible. Health requirements not met.'),
        { code: 'NOT_MERGE_ELIGIBLE' }
      );
    }

    await this._signalMerge(correlId);

    log.info('Merge signal sent to Bash orchestrator.', { correlId });
  }

  /**
   * Returns the current Git branch.
   * @returns {Promise<string>}
   */
  async getCurrentBranch() {
    try {
      const { stdout } = await execAsync(
        `cd "${GIT_CONFIG.KLYN_ROOT}" && git rev-parse --abbrev-ref HEAD`,
        { timeout: 5_000 }
      );
      return stdout.trim();
    } catch (err) {
      log.warn('Failed to get current branch.', { reason: err.message });
      return 'unknown';
    }
  }

  /**
   * Returns the last commit hash.
   * @returns {Promise<string>}
   */
  async getLastCommitHash() {
    try {
      const { stdout } = await execAsync(
        `cd "${GIT_CONFIG.KLYN_ROOT}" && git rev-parse HEAD`,
        { timeout: 5_000 }
      );
      return stdout.trim();
    } catch (err) {
      log.warn('Failed to get commit hash.', { reason: err.message });
      return 'unknown';
    }
  }

  /**
   * Returns Git repository status.
   * @returns {Promise<object>}
   */
  async getStatus() {
    const branch     = await this.getCurrentBranch();
    const commitHash = await this.getLastCommitHash();

    return {
      branch,
      commitHash:     commitHash.slice(0, 7),
      mergeEligible:  this._mergeEligible,
      healthyDuration: this._healthyStart
        ? Date.now() - this._healthyStart
        : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — HEALTH MONITORING
  // ---------------------------------------------------------------------------

  _startHealthMonitor() {
    setInterval(async () => {
      await this._checkSystemHealth();
    }, GIT_CONFIG.HEALTH_CHECK_INTERVAL_MS).unref();

    // Immediate first check
    setImmediate(() => this._checkSystemHealth());
  }

  async _checkSystemHealth() {
    // Get overall system health from manifest
    const healthSnapshot = manifest.snapshot();
    const systemHealth   = healthSnapshot.systemHealth;

    // Get agent-level health from executor
    const agentHealth = this._executor.getHealthSummary();

    // Determine if system is fully healthy
    const isHealthy = (
      systemHealth === SYSTEM_HEALTH.HEALTHY &&
      // @ts-ignore
      Object.values(agentHealth).every(agent => agent.healthy)
    );

    log.debug('System health check.', {
      systemHealth,
      isHealthy,
      agentHealthSummary: Object.entries(agentHealth)
        // @ts-ignore
        .map(([id, h]) => `${id}:${h.healthy ? 'OK' : 'FAIL'}`)
        .join(', '),
    });

    // Track health stability
    if (isHealthy) {
      if (!this._healthyStart) {
        this._healthyStart = Date.now();
        log.info('System entered HEALTHY state. Stability window started.');
      }

      const healthyDuration = Date.now() - this._healthyStart;

      if (healthyDuration >= GIT_CONFIG.HEALTH_STABILITY_WINDOW_MS) {
        if (!this._mergeEligible) {
          this._mergeEligible = true;
          log.info('System health stable. Merge to main is now eligible.', {
            healthyDurationMs: healthyDuration,
          });

          manifest.updateMetrics('GitHealthManager', {
            mergeEligible: true,
            lastEligibleAt: Date.now(),
          });

          bus.emit('git:merge_eligible', {
            healthyDurationMs: healthyDuration,
          }, generateCorrelationId());

          // Auto-trigger merge if enabled
          if (GIT_CONFIG.AUTO_MERGE_ENABLED) {
            await this._autoTriggerMerge();
          }
        }
      }

    } else {
      // Health degraded - reset stability window
      if (this._healthyStart) {
        const duration = Date.now() - this._healthyStart;
        log.warn('System health degraded. Stability window reset.', {
          previousDurationMs: duration,
        });
        this._healthyStart  = null;
        this._mergeEligible = false;

        manifest.updateMetrics('GitHealthManager', {
          mergeEligible: false,
        });
      }
    }

    this._lastHealth = isHealthy;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — MERGE OPERATIONS
  // ---------------------------------------------------------------------------

  async _autoTriggerMerge() {
    const correlId = generateCorrelationId();

    log.info('Auto-triggering merge to main branch.', { correlId });

    // Verify we're on the feature branch
    const currentBranch = await this.getCurrentBranch();
    if (currentBranch !== GIT_CONFIG.FEATURE_BRANCH) {
      log.warn('Cannot auto-merge: not on feature branch.', {
        currentBranch,
        expectedBranch: GIT_CONFIG.FEATURE_BRANCH,
      });
      return;
    }

    // Signal merge to Bash orchestrator
    await this._signalMerge(correlId);

    // Reset merge eligibility (require another stability window)
    this._mergeEligible = false;
    this._healthyStart  = null;

    log.info('Merge signal sent. Waiting for orchestrator to complete merge.');
  }

  /**
   * Writes the merge signal file that the Bash orchestrator monitors.
   * @param {string} correlId
   */
  async _signalMerge(correlId) {
    const signalFile = path.join(GIT_CONFIG.RUNTIME_DIR, 'git-merge-ready.signal');

    const signalData = {
      featureBranch:  GIT_CONFIG.FEATURE_BRANCH,
      mainBranch:     GIT_CONFIG.MAIN_BRANCH,
      triggeredAt:    Date.now(),
      correlId,
      currentCommit:  await this.getLastCommitHash(),
    };

    fs.writeFileSync(signalFile, JSON.stringify(signalData, null, 2), 'utf8');

    log.info('Merge signal file written.', {
      signalFile,
      correlId,
    });

    bus.emit('git:merge_signaled', signalData, correlId);
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — GIT REPOSITORY VERIFICATION
  // ---------------------------------------------------------------------------

  _verifyGitRepository() {
    const gitDir = path.join(GIT_CONFIG.KLYN_ROOT, '.git');

    if (!fs.existsSync(gitDir)) {
      log.warn('Git repository not detected. Git health management disabled.', {
        klynRoot: GIT_CONFIG.KLYN_ROOT,
      });
      manifest.setDegraded('GitHealthManager', 'Git repository not initialized.');
    } else {
      log.info('Git repository verified.', { gitDir });
      manifest.setHealthy('GitHealthManager', 'Git repository operational.');
    }
  }
}

// =============================================================================
// SECTION 3: SINGLETON EXPORT
// =============================================================================

let _managerInstance = null;

function getGitHealthManager() {
  if (!_managerInstance) {
    _managerInstance = new GitHealthManager();
  }
  return _managerInstance;
}

export { getGitHealthManager, GitHealthManager, GIT_CONFIG };


export {};
