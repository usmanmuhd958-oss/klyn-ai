/**
 * =============================================================================
 * KLYN AI OS — Evolution Engine API (Agent Interface)
 * File: kernel/src/execution/evolution_api.js
 * Version: 1.0.0
 * =============================================================================
 *
 * PURPOSE:
 *   Provides the IPC message handlers that agents use to submit evolution
 *   proposals to the kernel. This is the bridge between the agent-side
 *   self-mutation requests and the kernel-side Evolution Engine.
 *
 * PROTOCOL:
 *   Agent sends:  EVOLUTION_PROPOSE message with patch proposal
 *   Kernel responds: EVOLUTION_RESULT with evolutionId and status
 *
 * =============================================================================
 */

'use strict';

const Protocol = require('../../../shared/protocol');
const { getEvolutionEngine } = require('./evolution_engine');
const { createLogger } = require('../observability/logger');

const log    = createLogger('EvolutionAPI');
const engine = getEvolutionEngine();

/**
 * Handles an EVOLUTION_PROPOSE message from an agent.
 *
 * @param {object} message  Validated protocol message.
 * @param {object} agentRecord  The agent record from orchestrator.
 * @param {Function} sendResponse  Function to send response back to agent.
 */
async function handleEvolutionProposal(message, agentRecord, sendResponse) {
  const { payload, correlId } = message;
  const { targetFile, patchContent, reason, expectedMetrics } = payload;

  log.info('Evolution proposal received from agent.', {
    agentId:    agentRecord.agentId,
    targetFile,
    reason,
    correlId,
  });

  try {
    const result = await engine.propose({
      targetFile,
      patchContent,
      reason,
      requesterId:     agentRecord.agentId,
      expectedMetrics,
      vaultToken:      payload.vaultToken,  // Agent must provide auth token
    });

    sendResponse(Protocol.MSG.EVOLUTION_RESULT, {
      success:     true,
      evolutionId: result.evolutionId,
      status:      result.status,
      commitHash:  result.commitHash,
    }, correlId);

    log.info('Evolution proposal accepted.', {
      agentId:     agentRecord.agentId,
      evolutionId: result.evolutionId,
      correlId,
    });

  } catch (err) {
    sendResponse(Protocol.MSG.EVOLUTION_RESULT, {
      success: false,
      error:   err.message,
      code:    err.code,
    }, correlId);

    log.error('Evolution proposal rejected.', {
      agentId:  agentRecord.agentId,
      reason:   err.message,
      code:     err.code,
      correlId,
    });
  }
}

/**
 * Handles an EVOLUTION_ROLLBACK message from an agent.
 *
 * @param {object} message
 * @param {object} agentRecord
 * @param {Function} sendResponse
 */
async function handleEvolutionRollback(message, agentRecord, sendResponse) {
  const { payload, correlId } = message;
  const { evolutionId } = payload;

  log.info('Evolution rollback requested by agent.', {
    agentId: agentRecord.agentId,
    evolutionId,
    correlId,
  });

  try {
    await engine.rollback(evolutionId);

    sendResponse(Protocol.MSG.EVOLUTION_RESULT, {
      success:     true,
      rolledBack:  true,
      evolutionId,
    }, correlId);

    log.info('Evolution rollback completed.', {
      agentId: agentRecord.agentId,
      evolutionId,
      correlId,
    });

  } catch (err) {
    sendResponse(Protocol.MSG.EVOLUTION_RESULT, {
      success: false,
      error:   err.message,
      code:    err.code,
    }, correlId);

    log.error('Evolution rollback failed.', {
      agentId:  agentRecord.agentId,
      evolutionId,
      reason:   err.message,
      correlId,
    });
  }
}

module.exports = Object.freeze({
  handleEvolutionProposal,
  handleEvolutionRollback,
});


export {};
