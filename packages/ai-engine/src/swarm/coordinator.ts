import type { AIProviderRouter } from "../router.js";

export interface AgentTask<T = string> {
  id: string;
  role: string;
  instruction: string;
  parse?: (output: string) => T;
}

export interface AgentResult<T = string> {
  taskId: string;
  role: string;
  output: T;
}

export interface SwarmOptions {
  concurrency?: number;
  failFast?: boolean;
}

export class AgentSwarmCoordinator {
  constructor(private readonly router: AIProviderRouter, private readonly options: SwarmOptions = {}) {}

  async run<T = string>(tasks: AgentTask<T>[]): Promise<AgentResult<T>[]> {
    const concurrency = Math.max(1, Math.floor(this.options.concurrency ?? 4));
    const results: AgentResult<T>[] = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = cursor++;
        const task = tasks[index];
        if (!task) return;
        try {
          const response = await this.router.generate({ system: `You are the ${task.role} agent in Klyn's execution swarm.`, input: task.instruction, maxOutputTokens: 4096 });
          results[index] = { taskId: task.id, role: task.role, output: task.parse ? task.parse(response.output) : response.output as T };
        } catch (error) {
          if (this.options.failFast !== false) throw error;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
    return results.filter((result): result is AgentResult<T> => result !== undefined);
  }
}
