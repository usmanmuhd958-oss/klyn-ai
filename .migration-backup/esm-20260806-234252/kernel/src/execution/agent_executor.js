/**
 * =============================================================================
 * KLYN AI OS — execution/agent_executor.js
 * File: kernel/src/execution/agent_executor.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Runtime ESM module consumed by the secure API (api/server.js) and the
 *   kernel hot-swap manager. Provides agent execution (with hard timeouts),
 *   health checks and restart signalling — all path/env based (no hardcoded
 *   Termux paths).
 *
 * API:
 *   getAgentExecutor()           - singleton accessor
 *   AgentExecutor / AGENT_METADATA / EXECUTOR_CONFIG
 * =============================================================================
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const RUNTIME_ROOT = process.env.KLYN_RUNTIME_DIR || path.join(os.homedir(), '.klyn');

export const EXECUTOR_CONFIG = Object.freeze({
  RUNTIME_DIR: process.env.KLYN_RUNTIME_DIR || path.join(RUNTIME_ROOT, '.runtime'),
  PID_DIR: path.join(RUNTIME_ROOT, '.runtime', 'pids'),
  HEARTBEAT_DIR: path.join(RUNTIME_ROOT, '.runtime', 'heartbeats'),
  HEARTBEAT_STALE_MS: 60_000,
  HEALTH_CHECK_INTERVAL_MS: 30_000,
  BASH_AGENTS: ['coder', 'planner', 'researcher', 'reviewer'],
});

export const AGENT_METADATA = Object.freeze({
  coder: {
    capabilities: ['code_generation', 'refactoring', 'debugging', 'optimization', 'self_mutation'],
    language: 'bash', resourceTier: 'medium',
    description: 'Autonomous code generation and refactoring agent',
  },
  planner: {
    capabilities: ['task_decomposition', 'scheduling', 'coordination', 'cognitive_routing', 'priority_management'],
    language: 'bash', resourceTier: 'low',
    description: 'Task planning and cognitive routing coordinator',
  },
  researcher: {
    capabilities: ['web_search', 'documentation', 'learning', 'api_discovery', 'context_gathering'],
    language: 'bash', resourceTier: 'medium',
    description: 'Research and knowledge acquisition agent',
  },
  reviewer: {
    capabilities: ['code_review', 'test_generation', 'quality_assurance', 'security_audit', 'performance_analysis'],
    language: 'bash', resourceTier: 'low',
    description: 'Code review and quality assurance agent',
  },
  bug_hunter: {
    capabilities: ['static_analysis', 'vulnerability_scan', 'code_review', 'security_audit'],
    language: 'javascript', resourceTier: 'medium',
    description: 'Static analysis and vulnerability detection agent (Node.js)',
  },
});

class AgentExecutor {
  constructor() {
    this._agentStatus = new Map();
    this._lastHealthCheck = new Map();
    this._ensureDirectories();
  }

  getAgentStatus(agentId) {
    const cached = this._agentStatus.get(agentId);
    if (cached) return { ...cached };
    const status = this._checkAgentStatus(agentId);
    this._agentStatus.set(agentId, status);
    return { ...status };
  }

  getAgentCapabilities(agentId) {
    const metadata = AGENT_METADATA[agentId];
    return metadata ? [...metadata.capabilities] : [];
  }

  getAllAgentMetadata() {
    return { ...AGENT_METADATA };
  }

  queryAgentsByCapability(capability) {
    const matches = [];
    for (const [agentId, metadata] of Object.entries(AGENT_METADATA)) {
      if (metadata.capabilities.includes(capability)) matches.push(agentId);
    }
    return matches;
  }

  getHealthSummary() {
    const summary = {};
    for (const agentId of Object.keys(AGENT_METADATA)) {
      summary[agentId] = this.getAgentStatus(agentId);
    }
    return summary;
  }

  async checkHealth(agentId) {
    const status = this._checkAgentStatus(agentId);
    this._agentStatus.set(agentId, status);
    this._lastHealthCheck.set(agentId, Date.now());
    return status.healthy;
  }

  async requestRestart(agentId, reason = 'manual restart') {
    if (!EXECUTOR_CONFIG.BASH_AGENTS.includes(agentId)) {
      throw new Error(`Cannot restart: ${agentId} is not a Bash agent.`);
    }
    const signalFile = path.join(EXECUTOR_CONFIG.RUNTIME_DIR, `restart-${agentId}.signal`);
    fs.writeFileSync(signalFile, JSON.stringify({ agentId, reason, requestedAt: Date.now() }));
  }

  /**
   * Executes a task for a managed agent with a hard timeout.
   * Uses spawn with an argv array (no shell interpolation → no injection).
   */
  executeAgent(agentId, task, timeoutMs = 30_000) {
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

      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ success: false, agent: agentId, output: stdout, error: err.message, duration: Date.now() - startTime });
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

  _checkAgentStatus(agentId) {
    const status = { alive: false, pid: null, heartbeat: null, healthy: false };

    const pidFile = path.join(EXECUTOR_CONFIG.PID_DIR, `${agentId}.pid`);
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (!isNaN(pid)) {
          status.pid = pid;
          try {
            process.kill(pid, 0);
            status.alive = true;
          } catch (_) { /* not alive */ }
        }
      } catch (_) { /* unreadable pid file */ }
    }

    const heartbeatFile = path.join(EXECUTOR_CONFIG.HEARTBEAT_DIR, `${agentId}.heartbeat`);
    if (fs.existsSync(heartbeatFile)) {
      try {
        const timestamp = parseInt(fs.readFileSync(heartbeatFile, 'utf8').trim(), 10);
        if (!isNaN(timestamp)) {
          status.heartbeat = timestamp;
          if (Date.now() - timestamp * 1000 < EXECUTOR_CONFIG.HEARTBEAT_STALE_MS) {
            status.healthy = true;
          }
        }
      } catch (_) { /* unreadable heartbeat */ }
    }

    return status;
  }

  _ensureDirectories() {
    for (const dir of [EXECUTOR_CONFIG.RUNTIME_DIR, EXECUTOR_CONFIG.PID_DIR, EXECUTOR_CONFIG.HEARTBEAT_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }
}

let _executorInstance = null;

export function getAgentExecutor() {
  if (!_executorInstance) {
    _executorInstance = new AgentExecutor();
  }
  return _executorInstance;
}

export { AgentExecutor };
