export type AgentEventType =
  | "agent.started"
  | "agent.thinking"
  | "agent.executing"
  | "agent.completed"
  | "code.changed";


export interface AgentRuntimeEvent {

  id:string;

  type:AgentEventType;

  agentId:string;

  message:string;

  timestamp:number;

}
