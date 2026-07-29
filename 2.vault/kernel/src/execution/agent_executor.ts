// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * =============================================================================
 * KLYN AI OS — Agent Executor
 * File: kernel/src/execution/agent_executor.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Manages agent process lifecycle from the kernel's perspective. This is
 *   the bridge between the Bash orchestrator (agents/src/orchestrator.sh)
 *   and the Node.js kernel orchestrator (kernel/orchestrator.js).
 *
 * RESPONSIBILITIES:
 *   - Monitor agent processes spawned by Bash orchestrator
 *   - Provide capability query interface for dynamic routing
 *   - Detect and report agent health status
 *   - Interface with hot-swap manager for code updates
 *   - Maintain agent registry with metadata
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

const log      = createLogger('AgentExecutor');
const manifest = getManifest();
const bus      = getEventBus();

// =============================================================================
// SECTION 1: CONFIGURATION
// =============================================================================

const EXECUTOR_CONFIG = Object.freeze({
  /** Path to runtime directory */
  RUNTIME_DIR: '/data/data/com.termux/files/home/klyn-ai-os/.runtime',

  /** Path to Bash orchestrator PID directory */
  PID_DIR: '/data/data/com.termux/files/home/klyn-ai-os/.runtime/pids',

  /** Path to agent heartbeat files */
  HEARTBEAT_DIR: '/data/data/com.termux/files/home/klyn-ai-os/.runtime/heartbeats',

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

/**
 * Static registry of agent capabilities and metadata.
 * This is the source of truth for the Cognitive Router's capability matching.
 */
const AGENT_METADATA = Object.freeze({
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

class AgentExecutor {
  [key: string]: any;

  constructor() {
    /**
     * Live agent status cache. Key = agentId.
     * @type {Map<string, AgentStatus>}
     */
    this._agentStatus = new Map();

    /**
     * Last health check timestamp per agent.
     * @type {Map<string, number>}
     */
    this._lastHealthCheck = new Map();

    manifest.register('AgentExecutor', {
      critical: false,
      metadata: { version: '1.0.0' },
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
   *
   * @param {string} agentId
   * @returns {{ alive: boolean, pid: number|null, heartbeat: number|null, healthy: boolean }}
   */
  getAgentStatus(agentId) {
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
   *
   * @param {string} agentId
   * @returns {string[]}
   */
  getAgentCapabilities(agentId) {
    const metadata = AGENT_METADATA[agentId];
    return metadata ? [...metadata.capabilities] : [];
  }

  /**
   * Returns metadata for all registered agents.
   *
   * @returns {object}
   */
  getAllAgentMetadata() {
    return { ...AGENT_METADATA };
  }

  /**
   * Queries which agents have a specific capability.
   *
   * @param {string} capability
   * @returns {string[]}  Array of agent IDs
   */
  queryAgentsByCapability(capability) {
    const matches = [];
    for (const [agentId, metadata] of Object.entries(AGENT_METADATA)) {
      if (metadata.capabilities.includes(capability)) {
        matches.push(agentId);
      }
    }
    return matches;
  }

  /**
   * Returns a health summary of all agents.
   *
   * @returns {object}  { agentId → { alive, healthy, pid, lastHeartbeat } }
   */
  getHealthSummary() {
    const summary = {};
    for (const agentId of Object.keys(AGENT_METADATA)) {
      summary[agentId] = this.getAgentStatus(agentId);
    }
    return summary;
  }

  /**
   * Triggers a manual health check for a specific agent.
   *
   * @param {string} agentId
   * @returns {Promise<boolean>}  True if healthy
   */
  async checkHealth(agentId) {
    const status = this._checkAgentStatus(agentId);
    this._agentStatus.set(agentId, status);
    this._lastHealthCheck.set(agentId, Date.now());

    manifest.updateMetrics('AgentExecutor', {
      [`${agentId}_healthy`]: (status as any).healthy,
      [`${agentId}_pid`]:     (status as any).pid,
    });

    return (status as any).healthy;
  }

  /**
   * Requests a graceful restart of a Bash agent via the orchestrator.
   *
   * @param {string} agentId
   * @param {string} [reason]
   * @returns {Promise<void>}
   */
  async requestRestart(agentId, reason = 'manual restart') {
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

    bus.emit('agent:restart_requested', { agentId, reason }, generateCorrelationId());

    log.info('Restart signal written.', { agentId, signalFile });
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — STATUS CHECKING
  // ---------------------------------------------------------------------------

  /**
   * Performs a live status check for an agent.
   *
   * @param {string} agentId
   * @returns {{ alive: boolean, pid: number|null, heartbeat: number|null, healthy: boolean }}
   */
  _checkAgentStatus(agentId) {
    const status = {
      alive:     false,
      pid:       null,
      heartbeat: null,
      healthy:   false,
    };

    // Check 1: Read PID file
    const pidFile = path.join(EXECUTOR_CONFIG.PID_DIR, `${agentId}.pid`);
    if (fs.existsSync(pidFile)) {
      try {
        const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
        const pid    = parseInt(pidStr, 10);

        if (!isNaN(pid)) {
          (status as any).pid = pid;

          // Check if process is alive
          try {
            process.kill(pid, 0);  // Signal 0 = existence check
            (status as any).alive = true;
          } catch (_) {
            (status as any).alive = false;
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
          (status as any).heartbeat = timestamp;

          // Check if heartbeat is fresh
          const age = Date.now() - (timestamp * 1000);  // Convert to ms
          if (age < EXECUTOR_CONFIG.HEARTBEAT_STALE_MS) {
            (status as any).healthy = true;
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
      if (wasHealthy !== (status as any).healthy) {
        if ((status as any).healthy) {
          bus.emit('agent:recovered', { agentId }, generateCorrelationId());
          log.info('Agent recovered.', { agentId });
        } else {
          bus.emit('agent:degraded', { agentId }, generateCorrelationId());
          log.warn('Agent degraded.', { agentId });
        }
      }

      this._lastHealthCheck.set(`${agentId}_healthy`, (status as any).healthy);
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

let _executorInstance = null;

function getAgentExecutor() {
  if (!_executorInstance) {
    _executorInstance = new AgentExecutor();
  }
  return _executorInstance;
}

module.exports = Object.freeze({
  getAgentExecutor,
  AgentExecutor,
  AGENT_METADATA,
  EXECUTOR_CONFIG,
});


export {};
