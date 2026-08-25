import { executeAI } from "./gateway";
import { agentRegistry } from "./agentRegistry";
import { checkAgentPermission } from "./agentPermissionEngine";
import { klynEventBus } from "@/lib/runtime/eventBus";

export interface AgentTask {
  agentId: string;
  workspaceId: string;
  userId: string;
  instruction: string;
  action: string;
}

export interface AgentExecutionResult {
  agentId: string;
  success: boolean;
  output: string;
}

export class AgentExecutor {
  async execute(task: AgentTask): Promise<AgentExecutionResult> {
    const agent = agentRegistry.getById(task.agentId);

    try {
      checkAgentPermission(
        {
          workspaceId: task.workspaceId,
          userId: task.userId,
          agent
        },
        task.action as any
      );

      klynEventBus.emit("agent.started", {
        agentId: agent.id,
        action: task.action
      });

      const response = await executeAI({
        workspaceId: task.workspaceId,
        userId: task.userId,
        taskType: this.resolveTaskType(task.action),
        prompt: `
You are ${agent.name}.

Task:
${task.instruction}

Follow your assigned capabilities only.
`
      });

      klynEventBus.emit("agent.completed", {
        agentId: agent.id
      });

      return {
        agentId: agent.id,
        success: true,
        output: response.content
      };
    } catch (error) {
      klynEventBus.emit("agent.failed", {
        agentId: task.agentId,
        error: error instanceof Error ? error.message : "Unknown error"
      });

      return {
        agentId: task.agentId,
        success: false,
        output:
          error instanceof Error
            ? error.message
            : "Execution failed"
      };
    }
  }

  private resolveTaskType(action: string) {
    if (action.includes("review")) {
      return "analysis" as const;
    }

    if (action.includes("architecture")) {
      return "architecture" as const;
    }

    return "code_generation" as const;
  }
}

export const agentExecutor = new AgentExecutor();
