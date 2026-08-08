import { AgentExecutor } from '../../../packages/agent-runtime/src/executor/AgentExecutor.js';
/**
 * @deprecated
 * Use packages/agent-runtime/src/executor/AgentExecutor.ts
 */

export {
  AgentExecutor
} from "../../../packages/agent-runtime/src/executor/AgentExecutor.js";

export function getAgentExecutor() {
  return new AgentExecutor();
}
