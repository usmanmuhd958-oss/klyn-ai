// ── Evolution Engine Message Handlers ─────────────────────────────
const { handleEvolutionProposal, handleEvolutionRollback } = require('./execution/evolution_api');
const Protocol = require('../../shared/protocol');

// Register handlers for evolution messages
bus.on(Protocol.MSG.EVOLUTION_PROPOSE, async (msg, agentRecord, respond) => {
    await handleEvolutionProposal(msg, agentRecord, respond);
});
bus.on(Protocol.MSG.EVOLUTION_ROLLBACK, async (msg, agentRecord, respond) => {
    await handleEvolutionRollback(msg, agentRecord, respond);
});
