export interface AgentCapability {

  skills: string[];

  canExecute(task:string): boolean;

}
