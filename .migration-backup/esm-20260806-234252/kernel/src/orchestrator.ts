// ── Evolution Engine Message Handlers ─────────────────────────────
import { handleEvolutionProposal, handleEvolutionRollback } from './execution/evolution_api.js';
import Protocol from '../../shared/protocol.js';

// Register handlers for evolution messages
// @ts-ignore
bus.on(Protocol.MSG.EVOLUTION_PROPOSE, async (msg, agentRecord, respond) => {
    await handleEvolutionProposal(msg, agentRecord, respond);
});
// @ts-ignore
bus.on(Protocol.MSG.EVOLUTION_ROLLBACK, async (msg, agentRecord, respond) => {
    await handleEvolutionRollback(msg, agentRecord, respond);
});
