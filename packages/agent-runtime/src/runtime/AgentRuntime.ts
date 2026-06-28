import { AgentExecutor, AgentResult } from "../executor/AgentExecutor";
import { AgentMemory } from "../memory/AgentMemory";
import { AgentTask, AgentType } from "../types/agent.types";

export interface RuntimeResult {
  taskId: string;
  success: boolean;
  results: AgentResult[];
}

export class AgentRuntime {
  private executor = new AgentExecutor();
  private memory = new AgentMemory();

  async run(task: AgentTask): Promise<RuntimeResult> {
    const pipeline: AgentType[] = [
      "planner",
      "research",
      "coder",
      "reviewer",
      "security",
      "deployment",
      "docs",
    ];

    const results: AgentResult[] = [];

    for (const agent of pipeline) {
      const result = await this.executor.execute(agent, task);

      // save each step into memory (local for now)
      await this.memory.save(task.id, {
        agent,
        result,
        timestamp: Date.now(),
      });

      results.push(result);

      // STOP execution if failure happens
      if (!result.success) {
        return {
          taskId: task.id,
          success: false,
          results,
        };
      }
    }

    return {
      taskId: task.id,
      success: true,
      results,
    };
  }
}
