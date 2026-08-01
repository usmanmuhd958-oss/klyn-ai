export interface AgentContract {
  id: string;
  name: string;

  execute(task: unknown): Promise<unknown>;

  learn(experience: unknown): Promise<void>;
}
