/**
 * =============================================================================
 * KLYN AI OS — Hot-Swap Manager
 * File: kernel/src/execution/hot_swap_manager.ts
 * Version: 2.0.0
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
 * v2.0.0 CHANGES (memory-leak fix + lifecycle API + ESM):
 *   - New explicit lifecycle: register() / unregister() / swap() / dispose() / size
 *   - dispose() releases ALL state (registry, active swaps, history) and resets
 *     the module singleton so no code strings or records are retained forever
 *   - In-flight health monitors abort promptly after dispose() (no dangling 60s
 *     polling loop pinning closures in memory)
 *   - History is bounded (MAX_HISTORY); staged .swp/.tmp artifacts are removed
 *     on unregister() and after validation
 *   - Removed the `[key: string]: any` index signature (type-safety hole)
 *   - Removed hardcoded Termux paths; swap/agents dirs are now env-overridable
 *     (KLYN_SWAP_DIR / KLYN_AGENTS_DIR) with portable cwd-relative defaults
 *   - Converted to ESM (import/export) to run under "type": "module"
 * =============================================================================
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

import { createLogger, generateCorrelationId } from '../observability/logger.js';
import { getManifest } from '../observability/health_manifest.js';
import { getEventBus, LIFECYCLE_EVENT } from '../lifecycle/lifecycle_event_bus.js';
import { getAgentExecutor } from './agent_executor.js';

const log = createLogger('HotSwapManager');
const manifest = getManifest();
const bus = getEventBus();

// =============================================================================
// SECTION 1: CONFIGURATION (portable, env-overridable)
// =============================================================================

export const HOT_SWAP_CONFIG = Object.freeze({
  /** Path to swap staging directory */
  SWAP_DIR: process.env.KLYN_SWAP_DIR || path.resolve(process.cwd(), '.runtime', 'swap'),

  /** Path to agents directory */
  AGENTS_DIR: process.env.KLYN_AGENTS_DIR || path.resolve(process.cwd(), 'agents'),

  /** Post-swap health monitoring window (ms) */
  HEALTH_MONITOR_WINDOW_MS: 60_000,

  /** Health check interval during monitoring (ms) */
  HEALTH_CHECK_INTERVAL_MS: 5_000,

  /** Maximum script size (bytes) */
  MAX_SCRIPT_SIZE: 1024 * 1024,  // 1 MB

  /** Bounded swap history size */
  MAX_HISTORY: 50,

  /** Allowed agents for hot-swapping */
  ALLOWED_AGENTS: ['coder', 'planner', 'researcher', 'reviewer'],
});

// =============================================================================
// SECTION 2: TYPES
// =============================================================================

type SwapPhase = 'VALIDATING' | 'STAGING' | 'MONITORING' | 'COMPLETED' | 'FAILED';

interface SwapRecord {
  swapId: string;
  agentId: string;
  reason: string;
  correlId: string;
  initiatedAt: number;
  completedAt?: number;
  phase: SwapPhase;
  success: boolean | null;
  error: string | null;
  rollbackPerformed: boolean;
}

interface RegisteredAgent {
  agentId: string;
  code: string;
  version: number;
  registeredAt: number;
}

interface SwapOptions {
  reason?: string;
  correlId?: string;
}

interface SwapResult {
  swapId: string;
  success: boolean;
  agentId: string;
  version: number;
}

// =============================================================================
// SECTION 3: HOT-SWAP MANAGER
// =============================================================================

export class HotSwapManager {
  private readonly _executor: any;
  private readonly _activeSwaps = new Map<string, SwapRecord>();
  private readonly _registry = new Map<string, RegisteredAgent>();
  private _history: SwapRecord[] = [];
  private _disposed = false;

  constructor() {
    this._executor = getAgentExecutor();

    manifest.register('HotSwapManager', {
      critical: false,
      metadata: { version: '2.0.0' },
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

  /** Number of agents currently registered for hot-swapping. */
  get size(): number {
    return this._registry.size;
  }

  /** True once dispose() has been called; the instance is no longer usable. */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Registers an agent with its current code so hot-swaps can be tracked and
   * versioned. Throws if the agent is disallowed or already registered.
   */
  register(agentId: string, code: string, opts: SwapOptions = {}): RegisteredAgent {
    this._assertUsable();

    if (!HOT_SWAP_CONFIG.ALLOWED_AGENTS.includes(agentId)) {
      throw Object.assign(
        new Error(`Hot-swap not allowed for agent "${agentId}".`),
        { code: 'AGENT_NOT_ALLOWED' }
      );
    }

    if (Buffer.byteLength(code, 'utf8') > HOT_SWAP_CONFIG.MAX_SCRIPT_SIZE) {
      throw Object.assign(new Error('Code exceeds maximum size.'), { code: 'CODE_TOO_LARGE' });
    }

    if (this._registry.has(agentId)) {
      throw Object.assign(
        new Error(`Agent "${agentId}" is already registered.`),
        { code: 'AGENT_ALREADY_REGISTERED' }
      );
    }

    const agent: RegisteredAgent = {
      agentId,
      code,
      version: 1,
      registeredAt: Date.now(),
    };

    this._registry.set(agentId, agent);
    log.info('Agent registered for hot-swapping.', { agentId, version: agent.version, correlId: opts.correlId });

    return { ...agent };
  }

  /**
   * Unregisters an agent, dropping its code from memory and removing any staged
   * swap artifacts on disk. Returns true if the agent was registered.
   */
  unregister(agentId: string): boolean {
    this._assertUsable();

    const removed = this._registry.delete(agentId);

    // Clean up staged swap artifacts so no orphan files linger after unregister
    const swapFile = path.join(HOT_SWAP_CONFIG.SWAP_DIR, `${agentId}.sh.swp`);
    try {
      fs.unlinkSync(swapFile);
    } catch (_) { /* Ignore */ }

    if (removed) {
      log.info('Agent unregistered from hot-swapping.', { agentId });
    }
    return removed;
  }

  /**
   * Validates, stages and monitors a hot-swap of an agent's code. On success the
   * agent's registered code is updated and its version bumped. Agents that are
   * not yet registered are registered automatically on first swap.
   */
  async swap(agentId: string, newCode: string, opts: SwapOptions = {}): Promise<SwapResult> {
    this._assertUsable();

    const reason   = opts.reason || 'manual hot-swap';
    const correlId = opts.correlId || generateCorrelationId();

    if (Buffer.byteLength(newCode, 'utf8') > HOT_SWAP_CONFIG.MAX_SCRIPT_SIZE) {
      throw Object.assign(new Error('New code exceeds maximum size.'), { code: 'CODE_TOO_LARGE' });
    }

    let registered = this._registry.get(agentId);
    if (!registered) {
      // Register-on-first-swap keeps the registry authoritative while remaining ergonomic.
      registered = this.register(agentId, newCode, { reason, correlId });
    }

    log.info('Hot-swap initiated.', { agentId, reason, correlId });

    const swapId = this._generateSwapId();

    const swapRecord: SwapRecord = {
      swapId,
      agentId,
      reason,
      correlId,
      initiatedAt:     Date.now(),
      phase:           'VALIDATING',
      success:         null,
      error:           null,
      rollbackPerformed: false,
    };

    this._activeSwaps.set(swapId, swapRecord);

    try {
      // Phase 1: Validate
      await this._validateCode(agentId, newCode, swapRecord);

      // Phase 2: Stage
      await this._stageCode(agentId, newCode, swapRecord);

      // Phase 3: Signal (Bash orchestrator will detect and swap)

      // Phase 4: Monitor
      await this._monitorPostSwap(swapRecord);

      // Promote staged code into the registry (single copy per agent — bounded memory)
      const current = this._registry.get(agentId)!;
      current.code = newCode;
      current.version += 1;

      swapRecord.success = true;
      swapRecord.phase   = 'COMPLETED';
      swapRecord.completedAt = Date.now();

      this._addToHistory(swapRecord);
      this._activeSwaps.delete(swapId);

      log.info('Hot-swap completed successfully.', {
        swapId,
        agentId,
        version: current.version,
        correlId,
      });

      bus.emit(LIFECYCLE_EVENT.AGENT_HOT_SWAPPED, { swapId, agentId }, correlId);

      return { swapId, success: true, agentId, version: current.version };

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code    = (err as any)?.code;

      swapRecord.success = false;
      swapRecord.error   = message;
      swapRecord.phase   = 'FAILED';
      swapRecord.completedAt = Date.now();

      this._addToHistory(swapRecord);
      this._activeSwaps.delete(swapId);

      log.error('Hot-swap failed.', {
        swapId,
        agentId,
        reason:  message,
        code,
        correlId,
      });

      bus.emit(LIFECYCLE_EVENT.AGENT_HOT_SWAP_FAILED, { swapId, agentId, reason: message }, correlId);

      throw err;
    }
  }

  /** Backward-compatible alias of swap(). */
  async initiateSwap(options: {
    agentId: string;
    newCode: string;
    reason?: string;
    requesterId?: string;
    correlId?: string;
  }): Promise<{ swapId: string; success: boolean }> {
    const result = await this.swap(options.agentId, options.newCode, {
      reason: options.reason,
      correlId: options.correlId,
    });
    return { swapId: result.swapId, success: result.success };
  }

  /** Returns a copy of the swap history. */
  getHistory(): SwapRecord[] {
    return [...this._history];
  }

  /** Returns the status of an active swap (null if unknown/finished). */
  getSwapStatus(swapId: string): SwapRecord | null {
    return this._activeSwaps.get(swapId) ?? null;
  }

  /** Returns copies of all registered agents (code included). */
  getRegisteredAgents(): RegisteredAgent[] {
    return Array.from(this._registry.values()).map(a => ({ ...a }));
  }

  /**
   * Releases every resource held by this manager:
   *   - clears the agent registry and active-swap map (drops retained code strings)
   *   - clears the bounded history
   *   - marks the instance disposed so in-flight health monitors abort
   *   - resets the module singleton so the next getHotSwapManager() starts fresh
   */
  dispose(): void {
    if (this._disposed) return;

    this._disposed = true;
    this._registry.clear();
    this._activeSwaps.clear();
    this._history = [];

    // Release the singleton reference so the next getHotSwapManager() call
    // allocates a fresh instance instead of leaking this one forever.
    if (_managerInstance === this) {
      _managerInstance = null;
    }

    log.info('Hot-Swap Manager disposed; all state released.');
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private _assertUsable(): void {
    if (this._disposed) {
      throw Object.assign(
        new Error('Hot-Swap Manager has been disposed.'),
        { code: 'MANAGER_DISPOSED' }
      );
    }
  }

  /**
   * Phase 1: Validates the new code (bash syntax + security scan).
   */
  private async _validateCode(agentId: string, code: string, swapRecord: SwapRecord): Promise<void> {
    swapRecord.phase = 'VALIDATING';

    // Write to temp file for syntax check
    const tempFile = path.join(HOT_SWAP_CONFIG.SWAP_DIR, `${swapRecord.swapId}.tmp.sh`);
    fs.writeFileSync(tempFile, code, 'utf8');

    try {
      await execAsync(`bash -n "${tempFile}"`, { timeout: 5_000 });
    } catch (syntaxErr) {
      throw Object.assign(
        new Error(`Syntax validation failed: ${syntaxErr.message}`),
        { code: 'SYNTAX_ERROR' }
      );
    } finally {
      // Clean up temp file (no orphan artifacts left behind)
      try {
        fs.unlinkSync(tempFile);
      } catch (_) { /* Ignore */ }
    }

    // Security scan: detect dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\/(?!\s*data\/data\/com\.termux)/,  // Prevent root rm -rf
      /dd\s+if=/,                                     // Prevent disk writes
      /:\(\)\{\s*:\|:&\s*\};:/,                       // Fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw Object.assign(
          new Error('Security scan failed: dangerous pattern detected'),
          { code: 'SECURITY_VIOLATION' }
        );
      }
    }
  }

  /**
   * Phase 2: Stages the validated code for the Bash orchestrator to pick up.
   */
  private async _stageCode(agentId: string, code: string, swapRecord: SwapRecord): Promise<void> {
    swapRecord.phase = 'STAGING';

    const swapFile = path.join(HOT_SWAP_CONFIG.SWAP_DIR, `${agentId}.sh.swp`);
    fs.writeFileSync(swapFile, code, 'utf8');

    log.info('Code staged for hot-swap.', {
      swapId:   swapRecord.swapId,
      agentId,
      swapFile,
    });
  }

  /**
   * Phase 4: Monitors agent health post-swap. Auto-rolls back if health degrades.
   * Aborts early if the manager is disposed (prevents a dangling poll loop from
   * pinning the swap record and this closure in memory).
   */
  private async _monitorPostSwap(swapRecord: SwapRecord): Promise<void> {
    const { agentId, swapId, correlId } = swapRecord;
    swapRecord.phase = 'MONITORING';

    const startTime = Date.now();
    let checkCount  = 0;

    while (Date.now() - startTime < HOT_SWAP_CONFIG.HEALTH_MONITOR_WINDOW_MS) {
      if (this._disposed) return;

      await this._sleep(HOT_SWAP_CONFIG.HEALTH_CHECK_INTERVAL_MS);

      if (this._disposed) return;

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
    }

    log.info('Post-swap monitoring complete. No health issues detected.', {
      swapId,
      agentId,
      checkCount,
    });
  }

  /**
   * Performs an automatic rollback by requesting an agent restart (the Bash
   * orchestrator restores the pre-swap backup on restart).
   */
  private async _performRollback(swapRecord: SwapRecord): Promise<void> {
    const { agentId, swapId, correlId } = swapRecord;

    log.warn('Performing automatic rollback.', { swapId, agentId, correlId });

    await this._executor.requestRestart(agentId, `Rollback from failed swap ${swapId}`);

    bus.emit(LIFECYCLE_EVENT.AGENT_ROLLBACK, { swapId, agentId }, correlId);
  }

  private _ensureSwapDirectory(): void {
    if (!fs.existsSync(HOT_SWAP_CONFIG.SWAP_DIR)) {
      fs.mkdirSync(HOT_SWAP_CONFIG.SWAP_DIR, { recursive: true });
    }
  }

  private _generateSwapId(): string {
    return `swap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private _addToHistory(record: SwapRecord): void {
    this._history.push({ ...record });
    if (this._history.length > HOT_SWAP_CONFIG.MAX_HISTORY) {
      this._history.shift();
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// SECTION 4: SINGLETON EXPORT (dispose-aware)
// =============================================================================

let _managerInstance: HotSwapManager | null = null;

export function getHotSwapManager(): HotSwapManager {
  if (!_managerInstance || _managerInstance.disposed) {
    _managerInstance = new HotSwapManager();
  }
  return _managerInstance;
}
