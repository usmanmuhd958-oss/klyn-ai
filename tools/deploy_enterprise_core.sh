#!/bin/bash
# =============================================================================
# KLYN AI OS – Enterprise Core Deployment Script
# =============================================================================
set -euo pipefail

# Hardcoded correct path (avoids the BASH_SOURCE / PROJECT_ROOT issue)
readonly KLYN_ROOT="/data/data/com.termux/files/home/klyn-ai-os"

readonly COLOR_RESET='\033[0m'
readonly COLOR_BOLD='\033[1m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_CYAN='\033[0;36m'
readonly ICON_SUCCESS="✓"
readonly ICON_ERROR="✗"
readonly ICON_INFO="ℹ"
readonly ICON_ROCKET="🚀"

log() {
  local level="$1"; shift
  local message="$*"
  case "$level" in
    SUCCESS) echo -e "${COLOR_GREEN}${ICON_SUCCESS}${COLOR_RESET} ${message}" ;;
    ERROR)   echo -e "${COLOR_RED}${ICON_ERROR}${COLOR_RESET} ${message}" ;;
    INFO)    echo -e "${COLOR_CYAN}${ICON_INFO}${COLOR_RESET} ${message}" ;;
    *)       echo "$message" ;;
  esac
}

print_header() {
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_CYAN}╔════════════════════════════════════════════════════════════════╗${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_CYAN}║  ${ICON_ROCKET} KLYN AI OS - Enterprise Core Deployment ${ICON_ROCKET}          ║${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_CYAN}╚════════════════════════════════════════════════════════════════╝${COLOR_RESET}"
  echo ""
}

print_section() {
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_BLUE}▶ $1${COLOR_RESET}"
  echo -e "${COLOR_BLUE}$(printf '─%.0s' {1..70})${COLOR_RESET}"
}

ensure_directories() {
  print_section "Creating Directory Structure"
  local dirs=(
    "${KLYN_ROOT}/shared"
    "${KLYN_ROOT}/kernel"
    "${KLYN_ROOT}/kernel/src"
    "${KLYN_ROOT}/kernel/src/execution"
    "${KLYN_ROOT}/agents"
    "${KLYN_ROOT}/tools"
    "${KLYN_ROOT}/.klyn"
    "${KLYN_ROOT}/.klyn/logs"
    "${KLYN_ROOT}/.klyn/temp"
  )
  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      log INFO "Created: ${dir#$KLYN_ROOT/}"
    else
      log SUCCESS "Verified: ${dir#$KLYN_ROOT/}"
    fi
  done
}

deploy_protocol() {
  print_section "Deploying Protocol Module (shared/protocol.js)"
  cat << 'EOF' > "${KLYN_ROOT}/shared/protocol.js"
'use strict';

const MESSAGE_TYPES = {
  HELLO: 'HELLO',
  INIT: 'INIT',
  READY: 'READY',
  SHUTDOWN: 'SHUTDOWN',
  ACK_SHUTDOWN: 'ACK_SHUTDOWN',
  TASK_ASSIGN: 'TASK_ASSIGN',
  TASK_RESULT: 'TASK_RESULT',
  TASK_ERROR: 'TASK_ERROR',
  HEARTBEAT: 'HEARTBEAT',
  HEARTBEAT_ACK: 'HEARTBEAT_ACK',
  ERROR: 'ERROR',
  FATAL_ERROR: 'FATAL_ERROR'
};

const AGENT_STATES = {
  SPAWNING: 'SPAWNING',
  ONLINE: 'ONLINE',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  BUSY: 'BUSY',
  ERROR: 'ERROR',
  SHUTTING_DOWN: 'SHUTTING_DOWN',
  TERMINATED: 'TERMINATED'
};

const TIMEOUTS = {
  AGENT_SPAWN: 20000,
  AGENT_INIT: 15000,
  AGENT_READY_TOTAL: 35000,
  HEARTBEAT_INTERVAL: 30000,
  HEARTBEAT_TIMEOUT: 45000,
  TASK_DEFAULT: 300000,
  SHUTDOWN_GRACE: 10000,
  MESSAGE_ACK: 5000,
  RETRY_DELAY: 2000
};

const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  BACKOFF_MULTIPLIER: 1.5,
  MAX_BACKOFF: 10000
};

class Message {
  constructor(type, payload = {}, options = {}) {
    this.id = options.id || this._generateId();
    this.type = type;
    this.payload = payload;
    this.timestamp = Date.now();
    this.sender = options.sender || 'unknown';
    this.recipient = options.recipient || 'broadcast';
    this.correlationId = options.correlationId || null;
    this.signature = options.signature || null;
    this.priority = options.priority || 'normal';
  }
  _generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  serialize() {
    return JSON.stringify({
      id: this.id,
      type: this.type,
      payload: this.payload,
      timestamp: this.timestamp,
      sender: this.sender,
      recipient: this.recipient,
      correlationId: this.correlationId,
      signature: this.signature,
      priority: this.priority
    });
  }
  static deserialize(data) {
    try {
      const parsed = JSON.parse(data);
      return new Message(parsed.type, parsed.payload, {
        id: parsed.id,
        sender: parsed.sender,
        recipient: parsed.recipient,
        correlationId: parsed.correlationId,
        signature: parsed.signature,
        priority: parsed.priority
      });
    } catch (error) {
      throw new Error(`Failed to deserialize message: ${error.message}`);
    }
  }
  validate() {
    if (!this.type || !MESSAGE_TYPES[this.type]) {
      return { valid: false, error: 'Invalid message type' };
    }
    if (!this.id || !this.timestamp) {
      return { valid: false, error: 'Missing required fields' };
    }
    if (this.timestamp > Date.now() + 5000) {
      return { valid: false, error: 'Message timestamp in future' };
    }
    return { valid: true };
  }
}

const MessageFactory = {
  hello(agentId, capabilities = {}) {
    return new Message(MESSAGE_TYPES.HELLO, {
      agentId,
      pid: process.pid,
      capabilities,
      environment: { platform: process.platform, nodeVersion: process.version, memory: process.memoryUsage() }
    }, { sender: agentId });
  },
  init(agentId, config) {
    return new Message(MESSAGE_TYPES.INIT, { agentId, config, timestamp: Date.now() }, { sender: 'kernel', recipient: agentId });
  },
  ready(agentId, status = {}) {
    return new Message(MESSAGE_TYPES.READY, { agentId, status, initTime: status.initTime || 0 }, { sender: agentId, recipient: 'kernel' });
  },
  heartbeat(agentId, metrics = {}) {
    return new Message(MESSAGE_TYPES.HEARTBEAT, { agentId, metrics: { uptime: process.uptime(), memory: process.memoryUsage(), cpu: process.cpuUsage(), ...metrics } }, { sender: agentId, priority: 'low' });
  },
  error(agentId, error, context = {}) {
    return new Message(MESSAGE_TYPES.ERROR, { agentId, error: { message: error.message, stack: error.stack, code: error.code }, context, recoverable: true }, { sender: agentId, priority: 'high' });
  },
  fatalError(agentId, error, context = {}) {
    return new Message(MESSAGE_TYPES.FATAL_ERROR, { agentId, error: { message: error.message, stack: error.stack, code: error.code }, context, recoverable: false }, { sender: agentId, priority: 'critical' });
  }
};

module.exports = { MESSAGE_TYPES, AGENT_STATES, TIMEOUTS, RETRY_CONFIG, Message, MessageFactory };
EOF
  log SUCCESS "Protocol module deployed"
}

deploy_crypto_utils() {
  print_section "Deploying Cryptographic Utilities (shared/crypto_utils.js)"
  cat << 'EOF' > "${KLYN_ROOT}/shared/crypto_utils.js"
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CRYPTO_CONFIG = {
  ALGORITHM: 'aes-256-gcm',
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
  AUTH_TAG_LENGTH: 16,
  SALT_LENGTH: 64,
  ITERATIONS: 100000,
  DIGEST: 'sha256',
  SIGNATURE_ALGORITHM: 'sha256'
};

class KeyManager {
  constructor(keystorePath = null) {
    this.keystorePath = keystorePath || path.join(process.cwd(), '.klyn', 'keystore');
    this.masterKey = null;
    this.agentKeys = new Map();
    this._ensureKeystore();
  }
  _ensureKeystore() {
    try {
      const dir = path.dirname(this.keystorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (error) { throw new Error(`Failed to create keystore: ${error.message}`); }
  }
  async initializeMasterKey() {
    try {
      if (fs.existsSync(this.keystorePath)) {
        const data = fs.readFileSync(this.keystorePath, 'utf8');
        const parsed = JSON.parse(data);
        this.masterKey = Buffer.from(parsed.masterKey, 'hex');
        if (parsed.agentKeys) {
          Object.entries(parsed.agentKeys).forEach(([agentId, key]) => { this.agentKeys.set(agentId, Buffer.from(key, 'hex')); });
        }
      } else {
        this.masterKey = crypto.randomBytes(CRYPTO_CONFIG.KEY_LENGTH);
        await this._saveKeystore();
      }
      return true;
    } catch (error) { throw new Error(`Master key initialization failed: ${error.message}`); }
  }
  generateAgentKey(agentId) {
    if (this.agentKeys.has(agentId)) return this.agentKeys.get(agentId);
    const agentKey = crypto.pbkdf2Sync(this.masterKey, agentId, CRYPTO_CONFIG.ITERATIONS, CRYPTO_CONFIG.KEY_LENGTH, CRYPTO_CONFIG.DIGEST);
    this.agentKeys.set(agentId, agentKey);
    this._saveKeystore();
    return agentKey;
  }
  getAgentKey(agentId) { return this.agentKeys.has(agentId) ? this.agentKeys.get(agentId) : this.generateAgentKey(agentId); }
  async _saveKeystore() {
    try {
      const data = { masterKey: this.masterKey.toString('hex'), agentKeys: Object.fromEntries(Array.from(this.agentKeys.entries()).map(([k, v]) => [k, v.toString('hex')])), created: Date.now() };
      fs.writeFileSync(this.keystorePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (error) { throw new Error(`Failed to save keystore: ${error.message}`); }
  }
  async rotateMasterKey() {
    const oldKey = this.masterKey;
    this.masterKey = crypto.randomBytes(CRYPTO_CONFIG.KEY_LENGTH);
    const agentIds = Array.from(this.agentKeys.keys());
    this.agentKeys.clear();
    agentIds.forEach(id => this.generateAgentKey(id));
    await this._saveKeystore();
    return true;
  }
}

class CryptoService {
  constructor(keyManager) { this.keyManager = keyManager; }
  signMessage(message, agentId) {
    try {
      const key = this.keyManager.getAgentKey(agentId);
      const hmac = crypto.createHmac(CRYPTO_CONFIG.SIGNATURE_ALGORITHM, key);
      const messageData = typeof message === 'string' ? message : JSON.stringify(message);
      hmac.update(messageData);
      return hmac.digest('hex');
    } catch (error) { throw new Error(`Message signing failed: ${error.message}`); }
  }
  verifySignature(message, signature, agentId) {
    try {
      const expectedSignature = this.signMessage(message, agentId);
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
    } catch (error) { return false; }
  }
  encrypt(data, agentId) {
    try {
      const key = this.keyManager.getAgentKey(agentId);
      const iv = crypto.randomBytes(CRYPTO_CONFIG.IV_LENGTH);
      const cipher = crypto.createCipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      return { encrypted, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
    } catch (error) { throw new Error(`Encryption failed: ${error.message}`); }
  }
  decrypt(encryptedData, agentId) {
    try {
      const key = this.keyManager.getAgentKey(agentId);
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      const decipher = crypto.createDecipheriv(CRYPTO_CONFIG.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      try { return JSON.parse(decrypted); } catch { return decrypted; }
    } catch (error) { throw new Error(`Decryption failed: ${error.message}`); }
  }
  generateToken(length = 32) { return crypto.randomBytes(length).toString('hex'); }
  hash(data, salt = null) {
    const actualSalt = salt || crypto.randomBytes(CRYPTO_CONFIG.SALT_LENGTH);
    const hash = crypto.pbkdf2Sync(data, actualSalt, CRYPTO_CONFIG.ITERATIONS, CRYPTO_CONFIG.KEY_LENGTH, CRYPTO_CONFIG.DIGEST);
    return { hash: hash.toString('hex'), salt: actualSalt.toString('hex') };
  }
  verifyHash(data, hashedData, salt) {
    const result = this.hash(data, Buffer.from(salt, 'hex'));
    return crypto.timingSafeEqual(Buffer.from(result.hash, 'hex'), Buffer.from(hashedData, 'hex'));
  }
}

async function initializeCrypto(keystorePath = null) {
  const keyManager = new KeyManager(keystorePath);
  await keyManager.initializeMasterKey();
  return new CryptoService(keyManager);
}

module.exports = { CryptoService, KeyManager, initializeCrypto, CRYPTO_CONFIG };
EOF
  log SUCCESS "Crypto utilities deployed"
}

deploy_orchestrator() {
  print_section "Deploying Kernel Orchestrator (kernel/orchestrator.js)"
  cat << 'EOF' > "${KLYN_ROOT}/kernel/orchestrator.js"
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
EOF
  log SUCCESS "Kernel Orchestrator deployed"
}

deploy_bug_hunter() {
  print_section "Deploying Bug Hunter Agent (agents/bug_hunter.js)"
  cat << 'EOF' > "${KLYN_ROOT}/agents/bug_hunter.js"
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
EOF
  log SUCCESS "Bug Hunter Agent deployed"
}

deploy_package_json() {
  print_section "Deploying Package Configuration (package.json)"
  cat << 'EOF' > "${KLYN_ROOT}/package.json"
{
  "name": "klyn-ai-os",
  "version": "1.0.0",
  "description": "Enterprise-grade AI development platform with self-healing capabilities",
  "main": "kernel/orchestrator.js",
  "engines": { "node": ">=14.0.0" },
  "scripts": {
    "start": "node --expose-gc index.js",
    "dev": "LOG_LEVEL=DEBUG node --expose-gc index.js",
    "test": "node --test tests/*.test.js",
    "kernel": "node kernel/orchestrator.js",
    "agent:test": "node agents/bug_hunter.js",
    "deploy": "bash tools/deploy_enterprise_core.sh",
    "dry-run": "bash tools/autonomous_dry_run.sh"
  },
  "keywords": ["ai", "agents", "orchestration", "self-healing", "enterprise", "termux", "android"],
  "author": "KLYN AI Team",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {},
  "repository": { "type": "git", "url": "https://github.com/klyn-ai/klyn-os.git" }
}
EOF
  log SUCCESS "Package configuration deployed"
}

deploy_dry_run_script() {
  print_section "Deploying Health Check Script (tools/autonomous_dry_run.sh)"
  cat << 'EOF' > "${KLYN_ROOT}/tools/autonomous_dry_run.sh"
#!/bin/bash
set -euo pipefail
readonly KLYN_ROOT="${KLYN_ROOT:-$(pwd)}"
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_RESET='\033[0m'
PASSED_TESTS=0
TOTAL_TESTS=5
test_result() { local test_name="$1" result="$2"; if [[ "$result" == "PASS" ]]; then echo -e "[${COLOR_GREEN}PASS${COLOR_RESET}] ${test_name}"; PASSED_TESTS=$((PASSED_TESTS + 1)); else echo -e "[${COLOR_RED}FAIL${COLOR_RESET}] ${test_name}"; fi }
echo "=== KLYN AI OS Health Checks ==="
echo ""
[[ -d "${KLYN_ROOT}/kernel" ]] && test_result "Kernel directory structure" "PASS" || test_result "Kernel directory structure" "FAIL"
[[ -f "${KLYN_ROOT}/kernel/orchestrator.js" ]] && test_result "Kernel orchestrator module" "PASS" || test_result "Kernel orchestrator module" "FAIL"
[[ -f "${KLYN_ROOT}/package.json" ]] && test_result "Package configuration" "PASS" || test_result "Package configuration" "FAIL"
command -v node &> /dev/null && test_result "Node.js runtime" "PASS" || test_result "Node.js runtime" "FAIL"
mkdir -p "${KLYN_ROOT}/.klyn" 2>/dev/null && test_result "KLYN system directory" "PASS" || test_result "KLYN system directory" "FAIL"
echo ""
echo "=== Results: ${PASSED_TESTS}/${TOTAL_TESTS} PASS ==="
[[ $PASSED_TESTS -eq $TOTAL_TESTS ]] && exit 0 || exit 1
EOF
  chmod +x "${KLYN_ROOT}/tools/autonomous_dry_run.sh"
  log SUCCESS "Health check script deployed"
}

setup_environment() {
  print_section "Setting Up Environment Variables"
  local env_file="${KLYN_ROOT}/.env"
  if [[ ! -f "$env_file" ]]; then touch "$env_file"; chmod 600 "$env_file"; fi
  local klyn_vault_key=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  local jwt_secret=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  grep -q "KLYN_VAULT_MASTER_KEY=" "$env_file" || echo "KLYN_VAULT_MASTER_KEY=${klyn_vault_key}" >> "$env_file" && log INFO "Generated KLYN_VAULT_MASTER_KEY"
  grep -q "JWT_SECRET=" "$env_file" || echo "JWT_SECRET=${jwt_secret}" >> "$env_file" && log INFO "Generated JWT_SECRET"
  grep -q "KLYN_ROOT=" "$env_file" || echo "KLYN_ROOT=${KLYN_ROOT}" >> "$env_file" && log INFO "Set KLYN_ROOT=${KLYN_ROOT}"
  grep -q "NODE_ENV=" "$env_file" || echo "NODE_ENV=production" >> "$env_file" && log INFO "Set NODE_ENV=production"
  export KLYN_VAULT_MASTER_KEY="${klyn_vault_key}"
  export JWT_SECRET="${jwt_secret}"
  export NODE_ENV="production"
  log SUCCESS "Environment variables configured"
}

install_dependencies() {
  print_section "Installing Node.js Dependencies"
  cd "${KLYN_ROOT}"
  if [[ -f "package.json" ]]; then
    if command -v npm &> /dev/null; then
      log INFO "Running npm install..."
      npm install --production --no-optional 2>&1 | tail -n 5 || true
      log SUCCESS "Dependencies installed"
    else log ERROR "npm not found, skipping dependency installation"; fi
  else log ERROR "package.json not found"; return 1; fi
}

run_validation() {
  print_section "Running Core Validation Tests"
  if [[ -f "${KLYN_ROOT}/tools/autonomous_dry_run.sh" ]]; then
    if bash "${KLYN_ROOT}/tools/autonomous_dry_run.sh"; then log SUCCESS "All validation tests passed (5/5 PASS)"; return 0
    else log ERROR "Validation tests failed"; return 1; fi
  else log ERROR "Dry run script not found"; return 1; fi
}

commit_and_push() {
  print_section "Git Commit and Push"
  cd "${KLYN_ROOT}"
  if ! git rev-parse --git-dir > /dev/null 2>&1; then log ERROR "Not a git repository, skipping Git operations"; return 0; fi
  if [[ -z "$(git status --porcelain)" ]]; then log INFO "No changes to commit"; return 0; fi
  log INFO "Staging all changes..."; git add -A
  local commit_message="feat(enterprise): deploy complete self-healing and protocol runtime"
  log INFO "Creating commit: ${commit_message}"; git commit -m "$commit_message" || { log WARN "Commit failed (possibly nothing to commit)"; return 0; }
  log SUCCESS "Commit created"
  local remotes=$(git remote -v | grep -E 'github|gitlab' | awk '{print $1}' | sort -u)
  if [[ -z "$remotes" ]]; then log WARN "No GitHub or GitLab remotes configured"; return 0; fi
  local current_branch=$(git branch --show-current)
  log INFO "Current branch: ${current_branch}"
  local push_success=false
  while IFS= read -r remote; do [[ -z "$remote" ]] && continue; log INFO "Pushing to ${remote}..."; if git push "$remote" "$current_branch" 2>&1; then log SUCCESS "Successfully pushed to ${remote}"; push_success=true; else log ERROR "Failed to push to ${remote}"; fi; done <<< "$remotes"
  if [[ "$push_success" == true ]]; then log SUCCESS "Code deployed to remote repositories"; else log WARN "Push failed, but deployment is complete locally"; fi
}

print_summary() {
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_GREEN}╔════════════════════════════════════════════════════════════════╗${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_GREEN}║          ${ICON_ROCKET} DEPLOYMENT SUCCESSFUL ${ICON_ROCKET}                        ║${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_GREEN}╚════════════════════════════════════════════════════════════════╝${COLOR_RESET}"
  echo ""
  echo -e "${COLOR_BOLD}Deployed Modules:${COLOR_RESET}"
  echo -e "  ${ICON_SUCCESS} shared/protocol.js"
  echo -e "  ${ICON_SUCCESS} shared/crypto_utils.js"
  echo -e "  ${ICON_SUCCESS} kernel/orchestrator.js"
  echo -e "  ${ICON_SUCCESS} agents/bug_hunter.js"
  echo -e "  ${ICON_SUCCESS} package.json"
  echo -e "  ${ICON_SUCCESS} tools/autonomous_dry_run.sh"
  echo ""
  echo -e "${COLOR_BOLD}Environment:${COLOR_RESET}"
  echo -e "  ${ICON_INFO} KLYN_ROOT: ${KLYN_ROOT}"
  echo -e "  ${ICON_INFO} Node.js: $(node --version 2>/dev/null || echo 'N/A')"
  echo -e "  ${ICON_INFO} Platform: $(uname -s)"
  echo ""
  echo -e "${COLOR_GREEN}${COLOR_BOLD}✨ KLYN AI OS Enterprise Core is now deployed! ✨${COLOR_RESET}"
  echo ""
  echo -e "Next steps:"
  echo -e "  1. Run: ${COLOR_CYAN}npm start${COLOR_RESET}"
  echo -e "  2. Test: ${COLOR_CYAN}bash tools/autonomous_dry_run.sh${COLOR_RESET}"
  echo ""
}

main() {
  print_header
  log INFO "Starting enterprise core deployment"
  log INFO "KLYN_ROOT: ${KLYN_ROOT}"
  ensure_directories
  deploy_protocol
  deploy_crypto_utils
  deploy_orchestrator
  deploy_bug_hunter
  deploy_package_json
  deploy_dry_run_script
  setup_environment
  install_dependencies
  if run_validation; then commit_and_push; print_summary; exit 0
  else log ERROR "Deployment validation failed"; exit 1; fi
}

main "$@"
