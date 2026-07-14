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
