'use strict';
const crypto = require('crypto');

const MSG = {
  AGENT_REGISTER:      'AGENT_REGISTER',
  AGENT_HEARTBEAT:     'AGENT_HEARTBEAT',
  AGENT_TASK_DISPATCH: 'AGENT_TASK_DISPATCH',
  AGENT_TASK_RESULT:   'AGENT_TASK_RESULT',
  AGENT_SHUTDOWN:      'AGENT_SHUTDOWN',
  KERNEL_BROADCAST:    'KERNEL_BROADCAST',
  EVOLUTION_PROPOSE:   'EVOLUTION_PROPOSE',
  EVOLUTION_RESULT:    'EVOLUTION_RESULT',
  EVOLUTION_ROLLBACK:  'EVOLUTION_ROLLBACK',
  EVOLUTION_STATUS:    'EVOLUTION_STATUS',
};

const PAYLOAD_SCHEMAS = {
  [MSG.AGENT_REGISTER]:      ['agentId', 'capabilities'],
  [MSG.AGENT_HEARTBEAT]:     ['agentId', 'timestamp'],
  [MSG.AGENT_TASK_DISPATCH]: ['taskId', 'taskType', 'payload'],
  [MSG.AGENT_TASK_RESULT]:   ['taskId', 'success', 'output'],
  [MSG.AGENT_SHUTDOWN]:      ['agentId'],
  [MSG.KERNEL_BROADCAST]:    ['message'],
  [MSG.EVOLUTION_PROPOSE]:   ['targetFile', 'patchContent', 'reason', 'requesterId'],
  [MSG.EVOLUTION_RESULT]:    ['success'],
  [MSG.EVOLUTION_ROLLBACK]:  ['evolutionId'],
  [MSG.EVOLUTION_STATUS]:    ['evolutionId'],
};

function validatePayload(type, payload) {
  const required = PAYLOAD_SCHEMAS[type];
  if (!required) {
    return { valid: false, errors: [`Unknown message type: ${type}`] };
  }
  const errors = [];
  for (const field of required) {
    if (!(field in payload) || payload[field] === undefined || payload[field] === null) {
      errors.push(`Missing required field: "${field}"`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function generateCorrelationId() {
  return `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function createEnvelope(type, payload, correlId) {
  return {
    type,
    payload,
    correlId: correlId || generateCorrelationId(),
    timestamp: Date.now(),
  };
}

module.exports = { MSG, PAYLOAD_SCHEMAS, validatePayload, generateCorrelationId, createEnvelope };
