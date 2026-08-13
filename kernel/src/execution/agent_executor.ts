
import {
  AgentExecutor
} from "@klyn/agent-runtime/executor";


let executorInstance: AgentExecutor | null = null;


export function getAgentExecutor(): AgentExecutor {

  if (!executorInstance) {
    executorInstance = new AgentExecutor();
  }

  return executorInstance;

}


export {
 AgentExecutor
};

