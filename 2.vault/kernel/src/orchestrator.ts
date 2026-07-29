// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// ── Evolution Engine Message Handlers ─────────────────────────────
const { handleEvolutionProposal, handleEvolutionRollback } = require('./execution/evolution_api');
const Protocol = require('../../shared/protocol');

// Register handlers for evolution messages
// @ts-ignore
bus.on(Protocol.MSG.EVOLUTION_PROPOSE, async (msg, agentRecord, respond) => {
    await handleEvolutionProposal(msg, agentRecord, respond);
});
// @ts-ignore
bus.on(Protocol.MSG.EVOLUTION_ROLLBACK, async (msg, agentRecord, respond) => {
    await handleEvolutionRollback(msg, agentRecord, respond);
});


export {};
