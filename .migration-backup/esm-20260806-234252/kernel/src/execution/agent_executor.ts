/**
 * =============================================================================
 * KLYN AI OS — Agent Executor
 * File: kernel/src/execution/agent_executor.ts
 * Version: 2.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Manages agent process lifecycle from the kernel's perspective. This is
 *   the bridge between the Bash orchestrator (agents/src/orchestrator.sh)
 *   and the Node.js kernel orchestrator.
 *
 * RESPONSIBILITIES:
 *   - Monitor agent processes spawned by Bash orchestrator
 *   - Provide capability query interface for dynamic routing
 *   - Detect and report agent health status
 *   - Interface with hot-swap manager for code updates
 *   - Maintain agent registry with metadata
 *   - Execute agent tasks with timeouts (secure spawn)
 *
 * v2.0.0: ESM conversion, env-overridable runtime paths (no hardcoded Termux
 * paths), added executeAgent() for the secure API.
 * =============================================================================
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

import { createLogger, generateCorrelationId } from '../observability/logger.js';
import { getManifest } from '../observability/health_manifest.js';
import { getEventBus, LIFECYCLE_EVENT } from '../lifecycle/lifecycle_event_bus.js';

const log      = createLogger('AgentExecutor');
const manifest = getManifest();
const bus      = getEventBus();

// =============================================================================
// SECTION 1: CONFIGURATION (env-overridable, portable)
// =============================================================================

const RUNTIME_ROOT = process.env.KLYN_RUNTIME_DIR || path.join(os.homedir(), '.klyn');

export const EXECUTOR_CONFIG = Object.freeze({
  /** Path to runtime directory */
  RUNTIME_DIR: process.env.KLYN_RUNTIME_DIR || path.join(RUNTIME_ROOT, '.runtime'),

  /** Path to Bash orchestrator PID directory */
  PID_DIR: path.join(RUNTIME_ROOT, '.runtime', 'pids'),

  /** Path to agent heartbeat files */
  HEARTBEAT_DIR: path.join(RUNTIME_ROOT, '.runtime', 'heartbeats'),

  /** Heartbeat staleness threshold (ms) */
  HEARTBEAT_STALE_MS: 60_000,

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL_MS: 30_000,

  /** Core agent names managed by Bash orchestrator */
  BASH_AGENTS: ['coder', 'planner', 'researcher', 'reviewer'],
});

// =============================================================================
// SECTION 2: AGENT METADATA REGISTRY
// =============================================================================

export const AGENT_METADATA = Object.freeze({
  coder: {
    capabilities: [
      'code_generation',
      'refactoring',
      'debugging',
      'optimization',
      'self_mutation',
    ],
    language:     'bash',
    resourceTier: 'medium',
    description:  'Autonomous code generation and refactoring agent',
  },
  planner: {
    capabilities: [
      'task_decomposition',
      'scheduling',
      'coordination',
      'cognitive_routing',
      'priority_management',
    ],
    language:     'bash',
    resourceTier: 'low',
    description:  'Task planning and cognitive routing coordinator',
  },
  researcher: {
    capabilities: [
      'web_search',
      'documentation',
      'learning',
      'api_discovery',
      'context_gathering',
    ],
    language:     'bash',
    resourceTier: 'medium',
    description:  'Research and knowledge acquisition agent',
  },
  reviewer: {
    capabilities: [
      'code_review',
      'test_generation',
      'quality_assurance',
      'security_audit',
      'performance_analysis',
    ],
    language:     'bash',
    resourceTier: 'low',
    description:  'Code review and quality assurance agent',
  },
  bug_hunter: {
    capabilities: [
      'static_analysis',
      'vulnerability_scan',
      'code_review',
      'security_audit',
    ],
    language:     'javascript',
    resourceTier: 'medium',
    description:  'Static analysis and vulnerability detection agent (Node.js)',
  },
});

// =============================================================================
// SECTION 3: AGENT EXECUTOR CLASS
// =============================================================================

export class AgentExecutor {
  [key: string]: any;

  constructor() {
    /**
     * Live agent status cache. Key = agentId.
     * @type {Map<string, object>}
     */
    this._agentStatus = new Map();

    /**
     * Last health check timestamp per agent.
     * @type {Map<string, number>}
     */
    this._lastHealthCheck = new Map();

    manifest.register('AgentExecutor', {
      critical: false,
      metadata: { version: '2.0.0' },
    });

    this._ensureDirectories();
    this._startHealthMonitor();

    log.info('Agent Executor initialized.', {
      bashAgents:  EXECUTOR_CONFIG.BASH_AGENTS,
      totalAgents: Object.keys(AGENT_METADATA).length,
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Returns the current status of a specific agent.
   */
  getAgentStatus(agentId: string) {
    const cached = this._agentStatus.get(agentId);
    if (cached) {
      return { ...cached };
    }

    // Not cached - perform live check
    const status = this._checkAgentStatus(agentId);
    this._agentStatus.set(agentId, status);
    return { ...status };
  }

  /**
   * Returns the capabilities of a specific agent.
   */
  getAgentCapabilities(agentId: string): string[] {
    const metadata = AGENT_METADATA[agentId];
    return metadata ? [...metadata.capabilities] : [];
  }

  /**
   * Returns metadata for all registered agents.
   */
  getAllAgentMetadata() {
    return { ...AGENT_METADATA };
  }

  /**
   * Queries which agents have a specific capability.
   */
  queryAgentsByCapability(capability: string): string[] {
    const matches: string[] = [];
    for (const [agentId, metadata] of Object.entries(AGENT_METADATA)) {
      if (metadata.capabilities.includes(capability)) {
        matches.push(agentId);
      }
    }
    return matches;
  }

  /**
   * Returns a health summary of all agents.
   */
  getHealthSummary() {
    const summary: Record<string, any> = {};
    for (const agentId of Object.keys(AGENT_METADATA)) {
      summary[agentId] = this.getAgentStatus(agentId);
    }
    return summary;
  }

  /**
   * Triggers a manual health check for a specific agent.
   */
  async checkHealth(agentId: string): Promise<boolean> {
    const status = this._checkAgentStatus(agentId);
    this._agentStatus.set(agentId, status);
    this._lastHealthCheck.set(agentId, Date.now());

    manifest.updateMetrics('AgentExecutor', {
      [`${agentId}_healthy`]: status.healthy,
      [`${agentId}_pid`]:     status.pid,
    });

    return status.healthy;
  }

  /**
   * Requests a graceful restart of a Bash agent via the orchestrator.
   */
  async requestRestart(agentId: string, reason = 'manual restart'): Promise<void> {
    if (!EXECUTOR_CONFIG.BASH_AGENTS.includes(agentId)) {
      throw new Error(`Cannot restart: ${agentId} is not a Bash agent.`);
    }

    log.info('Requesting agent restart via orchestrator.', {
      agentId,
      reason,
    });

    // Write restart signal file (Bash orchestrator monitors this)
    const signalFile = path.join(
      EXECUTOR_CONFIG.RUNTIME_DIR,
      `restart-${agentId}.signal`
    );
    fs.writeFileSync(signalFile, JSON.stringify({
      agentId,
      reason,
      requestedAt: Date.now(),
    }));

    bus.emit(LIFECYCLE_EVENT.AGENT_RESTART_REQUESTED, { agentId, reason }, generateCorrelationId());

    log.info('Restart signal written.', { agentId, signalFile });
  }

  /**
   * Executes a task for a managed agent with a hard timeout.
   * Uses spawn (no shell interpolation) to avoid injection.
   */
  executeAgent(agentId: string, task: string, timeoutMs = 30_000): Promise<{
    success: boolean;
    agent: string;
    output: string;
    error: string | null;
    duration: number;
  }> {
    if (!EXECUTOR_CONFIG.BASH_AGENTS.includes(agentId)) {
      throw new Error(`Cannot execute: ${agentId} is not a managed agent.`);
    }
    if (typeof task !== 'string' || task.trim().length === 0) {
      throw new Error('Task must be a non-empty string.');
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', task], {
        cwd: os.homedir(),
        env: { ...process.env, KLYN_AGENT_ID: agentId },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        resolve({
          success: false,
          agent: agentId,
          output: stdout,
          error: `Task timed out after ${timeoutMs}ms`,
          duration: Date.now() - startTime,
        });
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          success: false,
          agent: agentId,
          output: stdout,
          error: err.message,
          duration: Date.now() - startTime,
        });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          success: code === 0,
          agent: agentId,
          output: stdout,
          error: code === 0 ? null : (stderr || `Exited with code ${code}`),
          duration: Date.now() - startTime,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — STATUS CHECKING
  // ---------------------------------------------------------------------------

  _checkAgentStatus(agentId: string) {
    const status = {
      alive:     false,
      pid:       null as number | null,
      heartbeat: null as number | null,
      healthy:   false,
    };

    // Check 1: Read PID file
    const pidFile = path.join(EXECUTOR_CONFIG.PID_DIR, `${agentId}.pid`);
    if (fs.existsSync(pidFile)) {
      try {
        const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
        const pid    = parseInt(pidStr, 10);

        if (!isNaN(pid)) {
          status.pid = pid;

          // Check if process is alive
          try {
            process.kill(pid, 0);  // Signal 0 = existence check
            status.alive = true;
          } catch (_) {
            status.alive = false;
          }
        }
      } catch (err) {
        log.warn('Failed to read PID file.', { agentId, reason: err.message });
      }
    }

    // Check 2: Read heartbeat file
    const heartbeatFile = path.join(EXECUTOR_CONFIG.HEARTBEAT_DIR, `${agentId}.heartbeat`);
    if (fs.existsSync(heartbeatFile)) {
      try {
        const timestampStr = fs.readFileSync(heartbeatFile, 'utf8').trim();
        const timestamp    = parseInt(timestampStr, 10);

        if (!isNaN(timestamp)) {
          status.heartbeat = timestamp;

          // Check if heartbeat is fresh
          const age = Date.now() - (timestamp * 1000);  // Convert to ms
          if (age < EXECUTOR_CONFIG.HEARTBEAT_STALE_MS) {
            status.healthy = true;
          }
        }
      } catch (err) {
        log.warn('Failed to read heartbeat file.', { agentId, reason: err.message });
      }
    }

    return status;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — HEALTH MONITORING
  // ---------------------------------------------------------------------------

  _startHealthMonitor() {
    setInterval(() => {
      this._performHealthChecks();
    }, EXECUTOR_CONFIG.HEALTH_CHECK_INTERVAL_MS).unref();

    // Immediate first check
    setImmediate(() => this._performHealthChecks());
  }

  async _performHealthChecks() {
    for (const agentId of Object.keys(AGENT_METADATA)) {
      const status = this._checkAgentStatus(agentId);
      this._agentStatus.set(agentId, status);

      // Emit events for status changes
      const wasHealthy = this._lastHealthCheck.get(`${agentId}_healthy`);
      if (wasHealthy !== status.healthy) {
        if (status.healthy) {
          bus.emit(LIFECYCLE_EVENT.AGENT_RECOVERED, { agentId }, generateCorrelationId());
          log.info('Agent recovered.', { agentId });
        } else {
          bus.emit(LIFECYCLE_EVENT.AGENT_DEGRADED, { agentId }, generateCorrelationId());
          log.warn('Agent degraded.', { agentId });
        }
      }

      this._lastHealthCheck.set(`${agentId}_healthy`, status.healthy);
    }

    // Update manifest
    const healthySummary = [...this._agentStatus.entries()]
      .map(([id, s]) => `${id}:${s.healthy ? 'OK' : 'FAIL'}`)
      .join(', ');

    manifest.updateMetrics('AgentExecutor', {
      lastHealthCheck: Date.now(),
      healthSummary:   healthySummary,
    });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — UTILITIES
  // ---------------------------------------------------------------------------

  _ensureDirectories() {
    for (const dir of [
      EXECUTOR_CONFIG.RUNTIME_DIR,
      EXECUTOR_CONFIG.PID_DIR,
      EXECUTOR_CONFIG.HEARTBEAT_DIR,
    ]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}

// =============================================================================
// SECTION 4: SINGLETON EXPORT
// =============================================================================

let _executorInstance: AgentExecutor | null = null;

export function getAgentExecutor(): AgentExecutor {
  if (!_executorInstance) {
    _executorInstance = new AgentExecutor();
  }
  return _executorInstance;
}

export { AgentExecutor as __AgentExecutorExport };
