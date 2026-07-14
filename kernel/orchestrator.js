'use strict';

const { fork } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const os = require('os');
const { MESSAGE_TYPES, AGENT_STATES, TIMEOUTS, Message, MessageFactory } = require('../shared/protocol');
const { initializeCrypto } = require('../shared/crypto_utils');

class Logger {
  constructor(context = 'KERNEL') {
    this.context = context;
    this.levels = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
    this.currentLevel = process.env.LOG_LEVEL || 'INFO';
  }
  _log(level, message, meta = {}) {
    if (this.levels[level] <= this.levels[this.currentLevel]) {
      const timestamp = new Date().toISOString();
      const logEntry = { timestamp, level, context: this.context, message, ...meta };
      console.log(JSON.stringify(logEntry));
    }
  }
  error(message, meta) { this._log('ERROR', message, meta); }
  warn(message, meta) { this._log('WARN', message, meta); }
  info(message, meta) { this._log('INFO', message, meta); }
  debug(message, meta) { this._log('DEBUG', message, meta); }
}

class AgentInstance {
  constructor(id, type, config) {
    this.id = id;
    this.type = type;
    this.config = config;
    this.state = AGENT_STATES.SPAWNING;
    this.process = null;
    this.pid = null;
    this.spawnTime = Date.now();
    this.helloTime = null;
    this.initTime = null;
    this.readyTime = null;
    this.lastHeartbeat = null;
    this.missedHeartbeats = 0;
    this.taskCount = 0;
    this.errorCount = 0;
    this.helloPromise = null;
    this.readyPromise = null;
    this.timeouts = { hello: null, ready: null, heartbeat: null };
  }
  updateState(newState) { const oldState = this.state; this.state = newState; return { oldState, newState }; }
  getMetrics() {
    return {
      id: this.id, type: this.type, state: this.state, pid: this.pid,
      uptime: this.readyTime ? Date.now() - this.readyTime : 0,
      initDuration: this.readyTime && this.spawnTime ? this.readyTime - this.spawnTime : 0,
      taskCount: this.taskCount, errorCount: this.errorCount,
      lastHeartbeat: this.lastHeartbeat, missedHeartbeats: this.missedHeartbeats
    };
  }
  clearTimeouts() {
    Object.values(this.timeouts).forEach(t => { if (t) clearTimeout(t); });
    this.timeouts = { hello: null, ready: null, heartbeat: null };
  }
}

class KernelOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      maxAgents: config.maxAgents || this._getOptimalMaxAgents(),
      heartbeatInterval: config.heartbeatInterval || TIMEOUTS.HEARTBEAT_INTERVAL,
      enableCrypto: config.enableCrypto !== false,
      agentPath: config.agentPath || path.join(__dirname, '..', 'agents'),
      ...config
    };
    this.logger = new Logger('ORCHESTRATOR');
    this.agents = new Map();
    this.cryptoService = null;
    this.isShuttingDown = false;
    this.metrics = { totalSpawned: 0, totalFailed: 0, totalRestarted: 0, avgInitTime: 0 };
  }
  _getOptimalMaxAgents() {
    const totalMemMB = os.totalmem() / (1024 * 1024);
    const cpuCount = os.cpus().length;
    if (totalMemMB < 2048) return 2;
    if (totalMemMB < 4096) return 4;
    if (totalMemMB < 8192) return Math.min(cpuCount, 6);
    return Math.min(cpuCount * 2, 10);
  }
  async initialize() {
    try {
      this.logger.info('Initializing Kernel Orchestrator', { maxAgents: this.config.maxAgents, nodeVersion: process.version, platform: process.platform });
      if (this.config.enableCrypto) { this.cryptoService = await initializeCrypto(); this.logger.info('Cryptographic services initialized'); }
      this._setupShutdownHandlers();
      this._startResourceMonitoring();
      this.logger.info('Kernel Orchestrator initialized successfully');
      return true;
    } catch (error) { this.logger.error('Failed to initialize orchestrator', { error: error.message, stack: error.stack }); throw error; }
  }
  async spawnAgent(agentType, agentConfig = {}) {
    const agentId = `${agentType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    try {
      if (this.agents.size >= this.config.maxAgents) throw new Error(`Maximum agent capacity reached (${this.config.maxAgents})`);
      this.logger.info('Spawning new agent', { agentId, agentType });
      const agent = new AgentInstance(agentId, agentType, agentConfig);
      this.agents.set(agentId, agent);
      const helloPromise = new Promise((resolve, reject) => { agent.helloPromise = { resolve, reject }; });
      const readyPromise = new Promise((resolve, reject) => { agent.readyPromise = { resolve, reject }; });
      const agentPath = path.join(this.config.agentPath, `${agentType}.js`);
      const childProcess = fork(agentPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { ...process.env, AGENT_ID: agentId, AGENT_TYPE: agentType, KERNEL_PID: process.pid } });
      agent.process = childProcess; agent.pid = childProcess.pid;
      this.logger.info('Agent process forked', { agentId, pid: agent.pid });
      childProcess.on('message', (data) => { this._handleAgentMessage(agentId, data); });
      childProcess.on('error', (error) => { this.logger.error('Agent process error', { agentId, error: error.message }); this._handleAgentFailure(agentId, error); });
      childProcess.on('exit', (code, signal) => { this.logger.warn('Agent process exited', { agentId, code, signal }); this._handleAgentExit(agentId, code, signal); });
      agent.timeouts.hello = setTimeout(() => { const error = new Error(`Agent ${agentId} did not send HELLO within ${TIMEOUTS.AGENT_SPAWN}ms`); agent.helloPromise.reject(error); this._handleAgentFailure(agentId, error); }, TIMEOUTS.AGENT_SPAWN);
      this.logger.debug('Waiting for HELLO from agent', { agentId });
      await helloPromise;
      clearTimeout(agent.timeouts.hello); agent.helloTime = Date.now(); agent.updateState(AGENT_STATES.ONLINE);
      this.logger.info('Received HELLO from agent', { agentId, helloLatency: agent.helloTime - agent.spawnTime });
      await this._sendInit(agent);
      agent.timeouts.ready = setTimeout(() => { const error = new Error(`Agent ${agentId} did not become READY within ${TIMEOUTS.AGENT_INIT}ms`); agent.readyPromise.reject(error); this._handleAgentFailure(agentId, error); }, TIMEOUTS.AGENT_INIT);
      this.logger.debug('Waiting for READY from agent', { agentId });
      await readyPromise;
      clearTimeout(agent.timeouts.ready); agent.readyTime = Date.now(); agent.updateState(AGENT_STATES.READY);
      const totalInitTime = agent.readyTime - agent.spawnTime;
      this.logger.info('Agent fully initialized', { agentId, totalInitTime });
      this.metrics.totalSpawned++; this._updateAvgInitTime(totalInitTime);
      this._startHeartbeatMonitoring(agentId);
      this.emit('agent:ready', agent.getMetrics());
      return agentId;
    } catch (error) {
      this.logger.error('Failed to spawn agent', { agentId, agentType, error: error.message });
      this.metrics.totalFailed++;
      if (this.agents.has(agentId)) { const agent = this.agents.get(agentId); agent.clearTimeouts(); if (agent.process) agent.process.kill('SIGTERM'); this.agents.delete(agentId); }
      throw error;
    }
  }
  async _sendInit(agent) {
    try {
      agent.updateState(AGENT_STATES.INITIALIZING);
      const initMessage = MessageFactory.init(agent.id, { ...agent.config, kernelPid: process.pid, heartbeatInterval: this.config.heartbeatInterval, cryptoEnabled: this.config.enableCrypto });
      if (this.cryptoService) initMessage.signature = this.cryptoService.signMessage(initMessage.serialize(), agent.id);
      agent.initTime = Date.now();
      agent.process.send(initMessage.serialize());
      this.logger.debug('INIT message sent', { agentId: agent.id });
    } catch (error) { throw new Error(`Failed to send INIT to ${agent.id}: ${error.message}`); }
  }
  _handleAgentMessage(agentId, data) {
    try {
      const message = Message.deserialize(data);
      const validation = message.validate();
      if (!validation.valid) { this.logger.warn('Invalid message received', { agentId, error: validation.error }); return; }
      if (this.cryptoService && message.signature) {
        const isValid = this.cryptoService.verifySignature(data, message.signature, agentId);
        if (!isValid) { this.logger.error('Message signature verification failed', { agentId }); return; }
      }
      const agent = this.agents.get(agentId);
      if (!agent) { this.logger.warn('Message from unknown agent', { agentId }); return; }
      switch (message.type) {
        case MESSAGE_TYPES.HELLO: this._handleHello(agent, message); break;
        case MESSAGE_TYPES.READY: this._handleReady(agent, message); break;
        case MESSAGE_TYPES.HEARTBEAT: this._handleHeartbeat(agent, message); break;
        case MESSAGE_TYPES.TASK_RESULT: this._handleTaskResult(agent, message); break;
        case MESSAGE_TYPES.ERROR: this._handleError(agent, message); break;
        case MESSAGE_TYPES.FATAL_ERROR: this._handleFatalError(agent, message); break;
        default: this.logger.debug('Unhandled message type', { agentId, type: message.type });
      }
    } catch (error) { this.logger.error('Error handling agent message', { agentId, error: error.message }); }
  }
  _handleHello(agent, message) { this.logger.debug('Processing HELLO', { agentId: agent.id }); if (agent.helloPromise) { agent.helloPromise.resolve(message); agent.pid = message.payload.pid; } }
  _handleReady(agent, message) { this.logger.debug('Processing READY', { agentId: agent.id }); if (agent.readyPromise) agent.readyPromise.resolve(message); }
  _handleHeartbeat(agent, message) { agent.lastHeartbeat = Date.now(); agent.missedHeartbeats = 0; this.logger.debug('Heartbeat received', { agentId: agent.id }); const ack = new Message(MESSAGE_TYPES.HEARTBEAT_ACK, { timestamp: Date.now() }, { sender: 'kernel', recipient: agent.id }); agent.process.send(ack.serialize()); }
  _handleTaskResult(agent, message) { agent.taskCount++; agent.updateState(AGENT_STATES.READY); this.logger.info('Task completed', { agentId: agent.id }); this.emit('task:complete', { agentId: agent.id, result: message.payload }); }
  _handleError(agent, message) { agent.errorCount++; this.logger.warn('Agent reported error', { agentId: agent.id, error: message.payload.error }); this.emit('agent:error', { agentId: agent.id, error: message.payload.error }); }
  _handleFatalError(agent, message) { agent.errorCount++; this.logger.error('Agent reported fatal error', { agentId: agent.id, error: message.payload.error }); this._handleAgentFailure(agent.id, new Error(message.payload.error.message)); }
  _startHeartbeatMonitoring(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.lastHeartbeat = Date.now();
    const checkHeartbeat = () => {
      if (!this.agents.has(agentId)) return;
      const timeSinceLastBeat = Date.now() - agent.lastHeartbeat;
      if (timeSinceLastBeat > TIMEOUTS.HEARTBEAT_TIMEOUT) {
        agent.missedHeartbeats++;
        this.logger.warn('Heartbeat timeout', { agentId, missedHeartbeats: agent.missedHeartbeats });
        if (agent.missedHeartbeats >= 3) { this.logger.error('Agent unresponsive', { agentId }); this._handleAgentFailure(agentId, new Error('Heartbeat timeout')); return; }
      }
      agent.timeouts.heartbeat = setTimeout(checkHeartbeat, TIMEOUTS.HEARTBEAT_INTERVAL);
    };
    agent.timeouts.heartbeat = setTimeout(checkHeartbeat, TIMEOUTS.HEARTBEAT_INTERVAL);
  }
  async _handleAgentFailure(agentId, error) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    this.logger.error('Agent failure detected', { agentId, error: error.message, state: agent.state });
    agent.updateState(AGENT_STATES.ERROR); agent.clearTimeouts();
    this.emit('agent:failed', { agentId, error: error.message });
    if (!this.isShuttingDown && agent.errorCount < 3) {
      this.logger.info('Attempting agent restart', { agentId }); this.metrics.totalRestarted++;
      try { await this._restartAgent(agentId); } catch (restartError) { this.logger.error('Agent restart failed', { agentId, error: restartError.message }); }
    } else { if (agent.process) agent.process.kill('SIGKILL'); this.agents.delete(agentId); }
  }
  _handleAgentExit(agentId, code, signal) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.clearTimeouts();
    if (!this.isShuttingDown && code !== 0) this.logger.error('Agent exited unexpectedly', { agentId, code, signal });
    agent.updateState(AGENT_STATES.TERMINATED); this.agents.delete(agentId);
    this.emit('agent:terminated', { agentId, code, signal });
  }
  async _restartAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    const { type, config } = agent;
    if (agent.process) agent.process.kill('SIGTERM');
    this.agents.delete(agentId);
    await this.spawnAgent(type, config);
  }
  async sendTask(agentId, task) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.state !== AGENT_STATES.READY) throw new Error(`Agent ${agentId} not ready (state: ${agent.state})`);
    const taskMessage = new Message(MESSAGE_TYPES.TASK_ASSIGN, task, { sender: 'kernel', recipient: agentId, priority: task.priority || 'normal' });
    if (this.cryptoService) taskMessage.signature = this.cryptoService.signMessage(taskMessage.serialize(), agentId);
    agent.updateState(AGENT_STATES.BUSY);
    agent.process.send(taskMessage.serialize());
    this.logger.info('Task assigned', { agentId, taskId: taskMessage.id });
    return taskMessage.id;
  }
  getMetrics() {
    const agents = Array.from(this.agents.values()).map(a => a.getMetrics());
    return { system: { uptime: process.uptime(), memory: process.memoryUsage(), cpu: process.cpuUsage(), platform: process.platform }, orchestrator: { totalAgents: this.agents.size, maxAgents: this.config.maxAgents, ...this.metrics }, agents };
  }
  _updateAvgInitTime(newInitTime) { const total = this.metrics.totalSpawned; this.metrics.avgInitTime = ((this.metrics.avgInitTime * (total - 1)) + newInitTime) / total; }
  _startResourceMonitoring() {
    setInterval(() => {
      const metrics = this.getMetrics();
      const memUsagePercent = (metrics.system.memory.heapUsed / metrics.system.memory.heapTotal) * 100;
      if (memUsagePercent > 85) { this.logger.warn('High memory usage detected', { memUsagePercent }); if (global.gc) global.gc(); }
      this.logger.debug('Resource metrics', metrics);
    }, 60000);
  }
  _setupShutdownHandlers() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      this.logger.info('Initiating graceful shutdown', { signal });
      try { const shutdownPromises = Array.from(this.agents.values()).map(agent => this._shutdownAgent(agent.id)); await Promise.allSettled(shutdownPromises); this.logger.info('All agents shut down'); process.exit(0); }
      catch (error) { this.logger.error('Error during shutdown', { error: error.message }); process.exit(1); }
    };
    process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
  }
  async _shutdownAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.process) return;
    try {
      agent.updateState(AGENT_STATES.SHUTTING_DOWN); agent.clearTimeouts();
      const shutdownMsg = new Message(MESSAGE_TYPES.SHUTDOWN, { gracePeriod: TIMEOUTS.SHUTDOWN_GRACE }, { sender: 'kernel', recipient: agentId });
      agent.process.send(shutdownMsg.serialize());
      await new Promise((resolve) => { const timeout = setTimeout(() => { this.logger.warn('Agent shutdown timeout, forcing kill', { agentId }); agent.process.kill('SIGKILL'); resolve(); }, TIMEOUTS.SHUTDOWN_GRACE); agent.process.once('exit', () => { clearTimeout(timeout); resolve(); }); });
      this.agents.delete(agentId);
      this.logger.info('Agent shut down', { agentId });
    } catch (error) { this.logger.error('Error shutting down agent', { agentId, error: error.message }); if (agent.process) agent.process.kill('SIGKILL'); }
  }
  async shutdown() { this.logger.info('Shutting down orchestrator'); for (const agentId of Array.from(this.agents.keys())) { await this._shutdownAgent(agentId); } this.logger.info('Orchestrator shutdown complete'); }
}

module.exports = KernelOrchestrator;
