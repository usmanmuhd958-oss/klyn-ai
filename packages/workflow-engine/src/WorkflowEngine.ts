import { Workflow, WorkflowNode } from "./types/workflow.types";
import { AgentExecutor } from "../../agent-runtime/src/executor/AgentExecutor";
import { SupabaseAgentMemory } from "../../agent-runtime/src/memory/SupabaseAgentMemory";

export class WorkflowEngine {
  private executor = new AgentExecutor();
  private memory = new SupabaseAgentMemory();

  async run(workflow: Workflow, task: any) {
    const results: Record<string, any> = {};
    const completed = new Set<string>();

    const nodes = workflow.nodes;

    while (completed.size < nodes.length) {
      const readyNodes = nodes.filter(
        (n) =>
          !completed.has(n.id) &&
          (n.dependsOn ?? []).every((d) => completed.has(d))
      );

      if (readyNodes.length === 0) {
        throw new Error("Circular dependency or invalid workflow");
      }

      await Promise.all(
        readyNodes.map(async (node) => {
          const result = await this.executor.execute(node.agent as any, task);

          await this.memory.saveExecution({
            taskId: workflow.id,
            agent: node.agent,
            result,
          });

          results[node.id] = result;
          completed.add(node.id);
        })
      );
    }

    return {
      workflowId: workflow.id,
      status: "completed",
      results,
    };
  }
}
