export enum AgentStatus {

  CREATED = "created",

  LEARNING = "learning",

  READY = "ready",

  EXECUTING = "executing",

  EVOLVING = "evolving",

  OFFLINE = "offline"

}


export interface AgentLifecycle {

  status: AgentStatus;

  activate(): Promise<void>;

  deactivate(): Promise<void>;

}
