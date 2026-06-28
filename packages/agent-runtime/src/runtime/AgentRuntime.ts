import { AgentExecutor } from "../executor/AgentExecutor";
import { SupabaseAgentMemory } from "../memory/SupabaseAgentMemory";
import { AgentTask, AgentType } from "../types/agent.types";

export class AgentRuntime {
  private executor = new AgentExecutor();
  private memory = new SupabaseAgentMemory();

  async run(task: AgentTask) {
    const pipeline: AgentType[] = [
      "planner",
      "research",
      "coder",
      "reviewer",
      "security",
      "deployment",
      "docs",
    ];

    const results: any[] = [];

    for (const agent of pipeline) {
      // 1. EXECUTE AGENT
      const result = await this.executor.execute(agent, task);

      // 2. AUTO-PERSIST (NO MANUAL CALL ANYMORE)
      await this.memory.saveExecution({
        taskId: task.id,
        agent,
        result,
      });

      results.push(result);

      // 3. FAIL FAST CONTROL (ENTERPRISE SAFETY)
      if (!result.success) {
        return {
          taskId: task.id,
          success: false,
          failedAt: agent,
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
