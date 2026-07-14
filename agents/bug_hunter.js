'use strict';

const { MESSAGE_TYPES, Message, MessageFactory } = require('../shared/protocol');

class AgentLogger {
  constructor(agentId) {
    this.agentId = agentId;
    this.levels = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
    this.currentLevel = process.env.LOG_LEVEL || 'INFO';
  }
  _log(level, message, meta = {}) {
    if (this.levels[level] <= this.levels[this.currentLevel]) {
      const timestamp = new Date().toISOString();
      const logEntry = { timestamp, level, context: `AGENT:${this.agentId}`, message, pid: process.pid, ...meta };
      console.log(JSON.stringify(logEntry));
    }
  }
  error(message, meta) { this._log('ERROR', message, meta); }
  warn(message, meta) { this._log('WARN', message, meta); }
  info(message, meta) { this._log('INFO', message, meta); }
  debug(message, meta) { this._log('DEBUG', message, meta); }
}

class BugHunterAgent {
  constructor() {
    this.agentId = process.env.AGENT_ID || 'unknown';
    this.agentType = process.env.AGENT_TYPE || 'bug_hunter';
    this.logger = new AgentLogger(this.agentId);
    this.state = 'SPAWNING';
    this.config = null;
    this.heartbeatInterval = null;
    this.currentTask = null;
    this.initialized = false;
    this.metrics = { tasksCompleted: 0, tasksErred: 0, avgTaskDuration: 0, uptime: 0 };
    this.startTime = Date.now();
    this._checkMemoryPressure();
  }
  async initialize() {
    try {
      this.logger.info('Bug Hunter Agent initializing', { agentId: this.agentId, pid: process.pid });
      this._setupMessageHandlers();
      this._setupErrorHandlers();
      this._sendHello();
      await this._waitForInit();
      await this._performInitialization();
      this._sendReady();
      this.initialized = true;
      this.state = 'READY';
      this.logger.info('Bug Hunter Agent ready', { agentId: this.agentId, initDuration: Date.now() - this.startTime });
    } catch (error) { this.logger.error('Agent initialization failed', { error: error.message }); this._sendFatalError(error, { phase: 'initialization' }); process.exit(1); }
  }
  _setupMessageHandlers() {
    process.on('message', async (data) => {
      try { const message = Message.deserialize(data); await this._handleMessage(message); }
      catch (error) { this.logger.error('Error handling message', { error: error.message }); }
    });
  }
  _setupErrorHandlers() {
    process.on('uncaughtException', (error) => { this.logger.error('Uncaught exception', { error: error.message }); this._sendFatalError(error, { type: 'uncaughtException' }); process.exit(1); });
    process.on('unhandledRejection', (reason, promise) => { this.logger.error('Unhandled rejection', { reason: reason?.message || reason }); this._sendError(new Error(`Unhandled rejection: ${reason}`), { type: 'unhandledRejection' }); });
    process.on('SIGTERM', () => this._handleShutdown()); process.on('SIGINT', () => this._handleShutdown());
  }
  _sendHello() { const helloMessage = MessageFactory.hello(this.agentId, { type: this.agentType, capabilities: ['code_analysis', 'bug_detection', 'fix_suggestion'], version: '1.0.0' }); process.send(helloMessage.serialize()); this.logger.debug('HELLO sent to kernel'); }
  async _waitForInit() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('INIT timeout')); }, 30000);
      const handler = (data) => { try { const message = Message.deserialize(data); if (message.type === MESSAGE_TYPES.INIT) { clearTimeout(timeout); process.removeListener('message', handler); this.config = message.payload.config; this.logger.debug('INIT received', { config: this.config }); resolve(); } } catch (error) {} };
      process.on('message', handler);
    });
  }
  async _performInitialization() {
    this.patterns = { nullPointer: /\.(\w+)\s*\(/g, undefinedVar: /undefined/gi, raceCondition: /setTimeout|setInterval/gi, memoryLeak: /new\s+\w+\(.*\)/g, asyncIssues: /async|await|Promise/gi };
    if (this.config.heartbeatInterval) this._startHeartbeat(this.config.heartbeatInterval);
    this.logger.info('Bug detection patterns loaded', { patternCount: Object.keys(this.patterns).length });
  }
  _sendReady() { const readyMessage = MessageFactory.ready(this.agentId, { initTime: Date.now() - this.startTime, capabilities: ['code_analysis', 'bug_detection', 'fix_suggestion'], ready: true }); process.send(readyMessage.serialize()); this.logger.debug('READY sent to kernel'); }
  _startHeartbeat(interval) {
    this.heartbeatInterval = setInterval(() => {
      const memUsage = process.memoryUsage(); const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      if (memUsagePercent > 80) { this.logger.warn('High memory usage in agent', { memUsagePercent }); if (global.gc) global.gc(); }
      const heartbeat = MessageFactory.heartbeat(this.agentId, { state: this.state, tasksCompleted: this.metrics.tasksCompleted, currentTask: this.currentTask ? this.currentTask.id : null, uptime: Date.now() - this.startTime, memoryUsage: memUsage });
      process.send(heartbeat.serialize()); this.logger.debug('Heartbeat sent');
    }, interval);
  }
  _checkMemoryPressure() {
    setInterval(() => { const memUsage = process.memoryUsage(); const heapUsedMB = memUsage.heapUsed / 1024 / 1024; if (heapUsedMB > 256) { this.logger.warn('Memory pressure threshold exceeded', { heapUsedMB }); if (global.gc) global.gc(); } }, 10000);
  }
  async _handleMessage(message) {
    const validation = message.validate(); if (!validation.valid) { this.logger.warn('Invalid message', { error: validation.error }); return; }
    this.logger.debug('Message received', { type: message.type, id: message.id });
    switch (message.type) {
      case MESSAGE_TYPES.TASK_ASSIGN: await this._handleTask(message); break;
      case MESSAGE_TYPES.SHUTDOWN: await this._handleShutdown(); break;
      case MESSAGE_TYPES.HEARTBEAT_ACK: this.logger.debug('Heartbeat acknowledged'); break;
      default: this.logger.debug('Unhandled message type', { type: message.type });
    }
  }
  async _handleTask(message) {
    const taskStartTime = Date.now(); this.state = 'BUSY'; this.currentTask = { id: message.id, ...message.payload };
    this.logger.info('Task received', { taskId: message.id, type: this.currentTask.type });
    try {
      let result;
      switch (this.currentTask.type) {
        case 'analyze_code': result = await this._analyzeCode(this.currentTask.code); break;
        case 'detect_bugs': result = await this._detectBugs(this.currentTask.code); break;
        case 'suggest_fix': result = await this._suggestFix(this.currentTask.bug); break;
        default: throw new Error(`Unknown task type: ${this.currentTask.type}`);
      }
      const resultMessage = new Message(MESSAGE_TYPES.TASK_RESULT, { taskId: message.id, result, duration: Date.now() - taskStartTime }, { sender: this.agentId, recipient: 'kernel', correlationId: message.id });
      process.send(resultMessage.serialize());
      this.metrics.tasksCompleted++; const duration = Date.now() - taskStartTime; this._updateAvgTaskDuration(duration);
      this.logger.info('Task completed', { taskId: message.id, duration });
    } catch (error) {
      this.logger.error('Task failed', { taskId: message.id, error: error.message });
      this.metrics.tasksErred++;
      const errorMessage = new Message(MESSAGE_TYPES.TASK_ERROR, { taskId: message.id, error: { message: error.message } }, { sender: this.agentId, correlationId: message.id });
      process.send(errorMessage.serialize());
    } finally { this.currentTask = null; this.state = 'READY'; }
  }
  async _analyzeCode(code) {
    this.logger.debug('Analyzing code', { codeLength: code.length });
    const issues = []; const lines = code.split('\n');
    for (const [issueType, pattern] of Object.entries(this.patterns)) { const matches = code.match(pattern); if (matches) issues.push({ type: issueType, count: matches.length, severity: this._getSeverity(issueType) }); }
    lines.forEach((line, index) => { if (line.includes('console.log')) issues.push({ type: 'console_usage', line: index + 1, severity: 'low', suggestion: 'Use structured logger instead of console.log' }); if (line.includes('TODO') || line.includes('FIXME')) issues.push({ type: 'incomplete_code', line: index + 1, severity: 'medium', content: line.trim() }); });
    return { totalIssues: issues.length, issues, linesAnalyzed: lines.length, timestamp: Date.now() };
  }
  async _detectBugs(code) {
    this.logger.debug('Detecting bugs');
    const bugs = [];
    const hasSetTimeout = /setTimeout/.test(code); const hasAsync = /async|await/.test(code);
    if (hasSetTimeout && hasAsync) bugs.push({ type: 'potential_race_condition', severity: 'high', description: 'Mix of setTimeout and async/await detected', recommendation: 'Use Promise-based timing or proper synchronization' });
    if (/new Promise/.test(code) && !/\.catch/.test(code)) bugs.push({ type: 'unhandled_promise', severity: 'high', description: 'Promise without catch handler', recommendation: 'Add .catch() or try/catch for async/await' });
    const functionCalls = code.match(/(\w+)\.(\w+)\(/g); if (functionCalls) bugs.push({ type: 'potential_null_pointer', severity: 'medium', description: `${functionCalls.length} potential null pointer locations`, recommendation: 'Add null/undefined checks before method calls' });
    return { bugsFound: bugs.length, bugs, scanCompleted: Date.now() };
  }
  async _suggestFix(bug) {
    this.logger.debug('Generating fix suggestion', { bugType: bug.type });
    const suggestions = { race_condition: { fix: 'Replace setTimeout with async/await pattern', code: 'await new Promise(resolve => setTimeout(resolve, 1000));' }, unhandled_promise: { fix: 'Add proper error handling', code: 'try { const result = await somePromise(); } catch (error) { }' }, potential_null_pointer: { fix: 'Add null check', code: 'if (object && object.method) { object.method(); }' } };
    const suggestion = suggestions[bug.type] || { fix: 'Manual review required', code: '// No automated fix available' };
    return { bugType: bug.type, suggestion, confidence: suggestion.code !== '// No automated fix available' ? 0.85 : 0.0, timestamp: Date.now() };
  }
  _getSeverity(issueType) { const severityMap = { nullPointer: 'high', undefinedVar: 'high', raceCondition: 'critical', memoryLeak: 'high', asyncIssues: 'medium' }; return severityMap[issueType] || 'low'; }
  _updateAvgTaskDuration(newDuration) { const total = this.metrics.tasksCompleted; this.metrics.avgTaskDuration = ((this.metrics.avgTaskDuration * (total - 1)) + newDuration) / total; }
  _sendError(error, context = {}) { const errorMessage = MessageFactory.error(this.agentId, error, context); process.send(errorMessage.serialize()); }
  _sendFatalError(error, context = {}) { const fatalMessage = MessageFactory.fatalError(this.agentId, error, context); process.send(fatalMessage.serialize()); }
  async _handleShutdown() {
    this.logger.info('Shutting down agent'); this.state = 'SHUTTING_DOWN';
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.currentTask) { this.logger.info('Waiting for current task to complete'); await new Promise(resolve => setTimeout(resolve, 1000)); }
    const ackMessage = new Message(MESSAGE_TYPES.ACK_SHUTDOWN, { agentId: this.agentId, metrics: this.metrics }, { sender: this.agentId });
    process.send(ackMessage.serialize()); this.logger.info('Agent shutdown complete', { uptime: Date.now() - this.startTime, metrics: this.metrics }); process.exit(0);
  }
}

async function main() { const agent = new BugHunterAgent(); await agent.initialize(); }
main().catch(error => { console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', context: 'AGENT:BOOTSTRAP', message: 'Agent bootstrap failed', error: error.message, stack: error.stack })); process.exit(1); });
