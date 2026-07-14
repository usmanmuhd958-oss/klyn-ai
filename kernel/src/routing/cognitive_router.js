/**
 * =============================================================================
 * KLYN AI OS — Cognitive Task Router
 * File: kernel/src/routing/cognitive_router.js
 * Version: 1.0.0
 * Quantum Leap 2: Metric-Driven Cognitive Routing
 * =============================================================================
 *
 * CAPABILITY:
 *   Dynamic, decentralized task routing based on:
 *     - Real-time agent capability matching
 *     - Hardware resource availability (CPU, RAM, battery on Termux)
 *     - Historical agent performance metrics
 *     - Task complexity scoring
 *     - HMAC-verified agent heartbeats for trust scoring
 *
 * ARCHITECTURE:
 *   - Priority queue for task buffering
 *   - Capability registry (agents declare what they can do)
 *   - Resource monitor (tracks Android CPU/RAM via /proc)
 *   - Routing algorithm (match task → best agent based on multi-factor score)
 *   - Cryptographic heartbeat verification (prevent agent impersonation)
 *
 * ROUTING ALGORITHM:
 *   Score(agent, task) = w1·CapabilityMatch + w2·AvailableResources +
 *                        w3·HistoricalSuccess + w4·HeartbeatFreshness
 *
 *   Where:
 *     w1, w2, w3, w4 are configurable weights
 *     Each factor normalized to [0, 1]
 *
 * =============================================================================
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { createLogger, generateCorrelationId } = require('../observability/logger');
const { getManifest } = require('../observability/health_manifest');
const { getEventBus, LIFECYCLE_EVENT } = require('../lifecycle/lifecycle_event_bus');
const { verifyPayload } = require('../security/crypto_utils');

const log      = createLogger('CognitiveRouter');
const manifest = getManifest();
const bus      = getEventBus();

// =============================================================================
// SECTION 1: CONFIGURATION
// =============================================================================

const ROUTER_CONFIG = Object.freeze({
  /** Task queue capacity */
  MAX_QUEUE_SIZE: 1000,

  /** Task priority levels */
  PRIORITY: Object.freeze({
    CRITICAL: 100,
    HIGH:     75,
    NORMAL:   50,
    LOW:      25,
    BACKGROUND: 10,
  }),

  /** Routing score weights (must sum to 1.0) */
  WEIGHTS: Object.freeze({
    capabilityMatch:    0.40,
    availableResources: 0.25,
    historicalSuccess:  0.20,
    heartbeatFreshness: 0.15,
  }),

  /** Agent heartbeat timeout (ms) */
  HEARTBEAT_TIMEOUT_MS: 45_000,

  /** Resource thresholds for Android/Termux */
  RESOURCE_THRESHOLDS: Object.freeze({
    minFreeCPUPercent: 20,
    minFreeRAMMB:      128,
    maxBatteryDrain:   15,  // % per hour
  }),

  /** Task timeout defaults (ms) */
  TASK_TIMEOUT_DEFAULT_MS: 300_000,  // 5 minutes
});

// =============================================================================
// SECTION 2: TASK QUEUE
// =============================================================================

class TaskQueue {
  constructor() {
    this._queue = [];
  }

  enqueue(task) {
    if (this._queue.length >= ROUTER_CONFIG.MAX_QUEUE_SIZE) {
      throw new Error('Task queue is at capacity.');
    }
    this._queue.push(task);
    this._queue.sort((a, b) => b.priority - a.priority);  // Descending priority
  }

  dequeue() {
    return this._queue.shift() ?? null;
  }

  peek() {
    return this._queue[0] ?? null;
  }

  get size() {
    return this._queue.length;
  }

  find(predicate) {
    return this._queue.find(predicate);
  }

  remove(taskId) {
    const index = this._queue.findIndex(t => t.taskId === taskId);
    if (index !== -1) {
      this._queue.splice(index, 1);
      return true;
    }
    return false;
  }
}

// =============================================================================
// SECTION 3: CAPABILITY REGISTRY
// =============================================================================

class CapabilityRegistry {
  constructor() {
    /**
     * Agent capabilities. Key = agentId, Value = Set<capability>
     * @type {Map<string, Set<string>>}
     */
    this._capabilities = new Map();

    /**
     * Task type → required capabilities mapping
     * @type {Map<string, string[]>}
     */
    this._taskRequirements = new Map();

    this._registerDefaultCapabilities();
  }

  registerAgent(agentId, capabilities = []) {
    if (!this._capabilities.has(agentId)) {
      this._capabilities.set(agentId, new Set());
    }
    const agentCaps = this._capabilities.get(agentId);
    for (const cap of capabilities) {
      agentCaps.add(cap);
    }
    log.debug('Agent capabilities registered.', {
      agentId,
      capabilities: [...agentCaps],
    });
  }

  registerTaskRequirements(taskType, requiredCapabilities) {
    this._taskRequirements.set(taskType, requiredCapabilities);
  }

  matchCapabilities(agentId, taskType) {
    const agentCaps = this._capabilities.get(agentId);
    const required  = this._taskRequirements.get(taskType);

    if (!agentCaps || !required) return 0;

    const matches = required.filter(cap => agentCaps.has(cap)).length;
    return required.length > 0 ? matches / required.length : 0;
  }

  getAgentCapabilities(agentId) {
    return this._capabilities.get(agentId) ?? new Set();
  }

  _registerDefaultCapabilities() {
    // Default KLYN agent capabilities
    this.registerAgent('bug_hunter', ['static_analysis', 'vulnerability_scan', 'code_review']);
    this.registerAgent('coder', ['code_generation', 'refactoring', 'debugging']);
    this.registerAgent('planner', ['task_decomposition', 'scheduling', 'coordination']);
    this.registerAgent('reviewer', ['code_review', 'test_generation', 'quality_assurance']);
    this.registerAgent('researcher', ['web_search', 'documentation', 'learning']);

    // Default task requirements
    this.registerTaskRequirements('SCAN_FILE', ['static_analysis', 'vulnerability_scan']);
    this.registerTaskRequirements('GENERATE_CODE', ['code_generation']);
    this.registerTaskRequirements('REVIEW_PR', ['code_review', 'quality_assurance']);
    this.registerTaskRequirements('PLAN_PROJECT', ['task_decomposition', 'scheduling']);
    this.registerTaskRequirements('RESEARCH_TOPIC', ['web_search', 'documentation']);
  }
}

// =============================================================================
// SECTION 4: RESOURCE MONITOR (Termux/Android Specific)
// =============================================================================

class ResourceMonitor {
  constructor() {
    this._lastCPUSample    = null;
    this._lastBatterySample = null;
  }

  /**
   * Returns current resource availability metrics for Termux.
   * @returns {Promise<{ freeCPUPercent: number, freeRAMMB: number, batteryDrainPercent: number }>}
   */
  async getAvailability() {
    const cpu     = await this._getCPUAvailability();
    const ram     = this._getRAMAvailability();
    const battery = await this._getBatteryDrain();

    return {
      freeCPUPercent:     cpu,
      freeRAMMB:          ram,
      batteryDrainPercent: battery,
    };
  }

  /**
   * Reads /proc/stat to estimate CPU availability.
   * @returns {Promise<number>}  Percentage of free CPU (0-100)
   */
  async _getCPUAvailability() {
    try {
      const stat = fs.readFileSync('/proc/stat', 'utf8');
      const cpuLine = stat.split('\n').find(line => line.startsWith('cpu '));
      if (!cpuLine) return 50;  // Default

      const values = cpuLine.split(/\s+/).slice(1).map(Number);
      const [user, nice, system, idle] = values;
      const total = user + nice + system + idle;
      const usage = total - idle;

      if (this._lastCPUSample) {
        const totalDelta = total - this._lastCPUSample.total;
        const usageDelta = usage - this._lastCPUSample.usage;
        const usagePercent = totalDelta > 0 ? (usageDelta / totalDelta) * 100 : 50;
        this._lastCPUSample = { total, usage };
        return Math.max(0, 100 - usagePercent);
      }

      this._lastCPUSample = { total, usage };
      return 50;  // First sample - no delta

    } catch (err) {
      log.warn('CPU availability check failed.', { reason: err.message });
      return 50;  // Assume moderate availability
    }
  }

  /**
   * Reads /proc/meminfo to estimate free RAM.
   * @returns {number}  Free RAM in MB
   */
  _getRAMAvailability() {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (availMatch) {
        return Math.floor(parseInt(availMatch[1], 10) / 1024);  // Convert KB to MB
      }

      // Fallback: MemFree + Buffers + Cached
      const freeMatch    = meminfo.match(/MemFree:\s+(\d+)\s+kB/);
      const buffersMatch = meminfo.match(/Buffers:\s+(\d+)\s+kB/);
      const cachedMatch  = meminfo.match(/Cached:\s+(\d+)\s+kB/);

      if (freeMatch && buffersMatch && cachedMatch) {
        const free    = parseInt(freeMatch[1], 10);
        const buffers = parseInt(buffersMatch[1], 10);
        const cached  = parseInt(cachedMatch[1], 10);
        return Math.floor((free + buffers + cached) / 1024);
      }

      return os.freemem() / (1024 * 1024);  // Node.js fallback

    } catch (err) {
      log.warn('RAM availability check failed.', { reason: err.message });
      return os.freemem() / (1024 * 1024);
    }
  }

  /**
   * Estimates battery drain on Android via Termux API.
   * @returns {Promise<number>}  Battery drain % per hour (estimate)
   */
  async _getBatteryDrain() {
    try {
      // Termux API command: termux-battery-status
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('termux-battery-status', { timeout: 2_000 });
      const batteryData = JSON.parse(stdout);
      const currentPercent = batteryData.percentage;

      if (this._lastBatterySample) {
        const timeDeltaHours = (Date.now() - this._lastBatterySample.ts) / (1000 * 60 * 60);
        const percentDelta   = this._lastBatterySample.percent - currentPercent;
        const drainPerHour   = timeDeltaHours > 0 ? percentDelta / timeDeltaHours : 0;

        this._lastBatterySample = { percent: currentPercent, ts: Date.now() };
        return Math.max(0, drainPerHour);
      }

      this._lastBatterySample = { percent: currentPercent, ts: Date.now() };
      return 0;  // First sample

    } catch (err) {
      // termux-battery-status not available or failed
      return 0;  // Assume no battery constraint
    }
  }
}

// =============================================================================
// SECTION 5: AGENT PERFORMANCE TRACKER
// =============================================================================

class PerformanceTracker {
  constructor() {
    /**
     * Agent performance history. Key = agentId, Value = { successes, failures, avgDurationMs }
     * @type {Map<string, object>}
     */
    this._history = new Map();
  }

  recordTaskResult(agentId, taskType, success, durationMs) {
    if (!this._history.has(agentId)) {
      this._history.set(agentId, {
        successes:    0,
        failures:     0,
        totalDuration: 0,
        taskCount:    0,
      });
    }

    const record = this._history.get(agentId);
    if (success) {
      record.successes++;
    } else {
      record.failures++;
    }
    record.totalDuration += durationMs;
    record.taskCount++;
  }

  getSuccessRate(agentId) {
    const record = this._history.get(agentId);
    if (!record || record.taskCount === 0) return 0.5;  // Default
    return record.successes / record.taskCount;
  }

  getAverageDuration(agentId) {
    const record = this._history.get(agentId);
    if (!record || record.taskCount === 0) return 0;
    return record.totalDuration / record.taskCount;
  }
}

// =============================================================================
// SECTION 6: HEARTBEAT MONITOR
// =============================================================================

class HeartbeatMonitor {
  constructor() {
    /**
     * Agent heartbeats. Key = agentId, Value = { ts, hmac, verified }
     * @type {Map<string, object>}
     */
    this._heartbeats = new Map();
  }

  recordHeartbeat(agentId, hmac, sessionKey) {
    const verified = this._verifyHeartbeatHMAC(agentId, hmac, sessionKey);
    this._heartbeats.set(agentId, {
      ts:   Date.now(),
      hmac,
      verified,
    });
  }

  getHeartbeatFreshness(agentId) {
    const hb = this._heartbeats.get(agentId);
    if (!hb) return 0;

    const age = Date.now() - hb.ts;
    if (age > ROUTER_CONFIG.HEARTBEAT_TIMEOUT_MS) return 0;
    if (!hb.verified) return 0;  // Unverified heartbeat = untrusted

    // Freshness score: 1.0 at t=0, decays linearly to 0 at timeout
    return Math.max(0, 1 - (age / ROUTER_CONFIG.HEARTBEAT_TIMEOUT_MS));
  }

  _verifyHeartbeatHMAC(agentId, hmac, sessionKey) {
    if (!hmac || !sessionKey) return false;

    try {
      const payload = { agentId, ts: Date.now() };
      return verifyPayload(payload, hmac, sessionKey);
    } catch (_) {
      return false;
    }
  }
}

// =============================================================================
// SECTION 7: COGNITIVE ROUTER
// =============================================================================

class CognitiveRouter {

  constructor() {
    this._taskQueue       = new TaskQueue();
    this._capabilities    = new CapabilityRegistry();
    this._resourceMonitor = new ResourceMonitor();
    this._perfTracker     = new PerformanceTracker();
    this._heartbeatMonitor = new HeartbeatMonitor();

    /** Active tasks. Key = taskId, Value = { agentId, startTime, taskType } */
    this._activeTasks = new Map();

    manifest.register('CognitiveRouter', {
      critical: false,
      metadata: { version: '1.0.0' },
    });

    this._startRouterLoop();

    log.info('Cognitive Router initialized.', {
      queueCapacity: ROUTER_CONFIG.MAX_QUEUE_SIZE,
      weights:       ROUTER_CONFIG.WEIGHTS,
    });
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Enqueues a task for routing.
   *
   * @param {object} task
   * @param {string}   task.taskId        Unique task identifier.
   * @param {string}   task.taskType      Type of task (e.g., 'SCAN_FILE').
   * @param {object}   task.payload       Task-specific data.
   * @param {number}   [task.priority]    Priority level (default: NORMAL).
   * @param {number}   [task.timeoutMs]   Task timeout.
   * @param {string}   [task.correlId]    Correlation ID.
   */
  enqueueTask(task) {
    const { taskId, taskType, payload, priority, timeoutMs, correlId } = task;

    const normalizedTask = {
      taskId:    taskId || this._generateTaskId(),
      taskType,
      payload:   payload || {},
      priority:  priority ?? ROUTER_CONFIG.PRIORITY.NORMAL,
      timeoutMs: timeoutMs ?? ROUTER_CONFIG.TASK_TIMEOUT_DEFAULT_MS,
      correlId:  correlId || generateCorrelationId(),
      enqueuedAt: Date.now(),
    };

    this._taskQueue.enqueue(normalizedTask);

    log.info('Task enqueued for routing.', {
      taskId:   normalizedTask.taskId,
      taskType: normalizedTask.taskType,
      priority: normalizedTask.priority,
      queueSize: this._taskQueue.size,
      correlId: normalizedTask.correlId,
    });

    bus.emit('router:task_enqueued', {
      taskId:   normalizedTask.taskId,
      taskType: normalizedTask.taskType,
    }, normalizedTask.correlId);
  }

  /**
   * Records an agent heartbeat with HMAC verification.
   *
   * @param {string} agentId
   * @param {string} hmac         HMAC-SHA256 signature over { agentId, ts }.
   * @param {Buffer} sessionKey   Agent's session key for verification.
   */
  recordHeartbeat(agentId, hmac, sessionKey) {
    this._heartbeatMonitor.recordHeartbeat(agentId, hmac, sessionKey);
    log.debug('Heartbeat recorded.', { agentId });
  }

  /**
   * Registers agent capabilities.
   *
   * @param {string}   agentId
   * @param {string[]} capabilities
   */
  registerAgentCapabilities(agentId, capabilities) {
    this._capabilities.registerAgent(agentId, capabilities);
  }

  /**
   * Records the result of a completed task for performance tracking.
   *
   * @param {string}  taskId
   * @param {boolean} success
   */
  recordTaskResult(taskId, success) {
    const activeTask = this._activeTasks.get(taskId);
    if (!activeTask) {
      log.warn('Task result recorded for unknown task.', { taskId });
      return;
    }

    const duration = Date.now() - activeTask.startTime;
    this._perfTracker.recordTaskResult(
      activeTask.agentId,
      activeTask.taskType,
      success,
      duration
    );

    this._activeTasks.delete(taskId);

    log.info('Task completed.', {
      taskId,
      agentId:    activeTask.agentId,
      success,
      durationMs: duration,
    });

    bus.emit('router:task_completed', {
      taskId,
      agentId: activeTask.agentId,
      success,
      durationMs: duration,
    }, activeTask.correlId);
  }

  /**
   * Returns the current routing metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      queueSize:    this._taskQueue.size,
      activeTasks:  this._activeTasks.size,
      totalEnqueued: this._taskQueue.size + this._activeTasks.size,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE — ROUTING LOOP
  // ---------------------------------------------------------------------------

  _startRouterLoop() {
    setInterval(async () => {
      await this._routeNextTask();
    }, 1_000).unref();  // Route every 1 second
  }

  async _routeNextTask() {
    const task = this._taskQueue.peek();
    if (!task) return;

    // Get available agents
    const agents = this._getAvailableAgents();
    if (agents.length === 0) {
      log.debug('No available agents for routing. Task remains in queue.');
      return;
    }

    // Score each agent
    const scores = await Promise.all(
      agents.map(agentId => this._scoreAgent(agentId, task))
    );

    // Select best agent
    let bestAgent = null;
    let bestScore = -1;

    for (let i = 0; i < agents.length; i++) {
      if (scores[i] > bestScore) {
        bestScore = scores[i];
        bestAgent = agents[i];
      }
    }

    if (!bestAgent || bestScore === 0) {
      log.warn('No suitable agent found for task.', {
        taskId:   task.taskId,
        taskType: task.taskType,
      });
      return;
    }

    // Dequeue and dispatch
    this._taskQueue.dequeue();
    this._dispatchTask(task, bestAgent);
  }

  /**
   * Scores an agent for a specific task using the multi-factor algorithm.
   *
   * @param {string} agentId
   * @param {object} task
   * @returns {Promise<number>}  Score in [0, 1]
   */
  async _scoreAgent(agentId, task) {
    const w = ROUTER_CONFIG.WEIGHTS;

    // Factor 1: Capability match
    const capMatch = this._capabilities.matchCapabilities(agentId, task.taskType);

    // Factor 2: Resource availability
    const resources = await this._resourceMonitor.getAvailability();
    const resourceScore = this._normalizeResourceScore(resources);

    // Factor 3: Historical success rate
    const successRate = this._perfTracker.getSuccessRate(agentId);

    // Factor 4: Heartbeat freshness
    const freshness = this._heartbeatMonitor.getHeartbeatFreshness(agentId);

    const totalScore = (w.capabilityMatch * capMatch) +
                       (w.availableResources * resourceScore) +
                       (w.historicalSuccess * successRate) +
                       (w.heartbeatFreshness * freshness);

    log.debug('Agent scoring.', {
      agentId,
      taskType:       task.taskType,
      capMatch:       capMatch.toFixed(2),
      resourceScore:  resourceScore.toFixed(2),
      successRate:    successRate.toFixed(2),
      freshness:      freshness.toFixed(2),
      totalScore:     totalScore.toFixed(2),
    });

    return totalScore;
  }

  _normalizeResourceScore(resources) {
    const { freeCPUPercent, freeRAMMB, batteryDrainPercent } = resources;
    const thresholds = ROUTER_CONFIG.RESOURCE_THRESHOLDS;

    // Each factor contributes equally to resource score
    const cpuScore     = freeCPUPercent / 100;
    const ramScore     = Math.min(1, freeRAMMB / thresholds.minFreeRAMMB);
    const batteryScore = batteryDrainPercent < thresholds.maxBatteryDrain ? 1 : 0.5;

    return (cpuScore + ramScore + batteryScore) / 3;
  }

  _getAvailableAgents() {
    // In production, this queries the orchestrator's agent registry
    // For now, return all registered agents from capability registry
    return [...this._capabilities._capabilities.keys()];
  }

  _dispatchTask(task, agentId) {
    this._activeTasks.set(task.taskId, {
      agentId,
      taskType:  task.taskType,
      startTime: Date.now(),
      correlId:  task.correlId,
    });

    log.info('Task routed to agent.', {
      taskId:   task.taskId,
      taskType: task.taskType,
      agentId,
      correlId: task.correlId,
    });

    bus.emit('router:task_dispatched', {
      taskId:   task.taskId,
      taskType: task.taskType,
      agentId,
    }, task.correlId);

    // In production, this sends the task to the agent via the IPC mailbox
    // The orchestrator would handle the actual dispatch
  }

  _generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// =============================================================================
// SECTION 8: SINGLETON EXPORT
// =============================================================================

let _routerInstance = null;

function getCognitiveRouter() {
  if (!_routerInstance) {
    _routerInstance = new CognitiveRouter();
  }
  return _routerInstance;
}

module.exports = Object.freeze({
  getCognitiveRouter,
  CognitiveRouter,
  ROUTER_CONFIG,
});
