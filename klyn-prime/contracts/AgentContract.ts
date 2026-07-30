export interface AgentContract {
  id: string;
  name: string;
  capability: string[];

  reason(input: unknown): Promise<unknown>;

  execute(task: unknown): Promise<unknown>;

  learn(result: unknown): Promise<void>;

  status(): AgentStatus;
}


export interface AgentStatus {
  active: boolean;
  health: number;
  lastAction: string;
}
