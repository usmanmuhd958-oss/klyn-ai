import { klynEventBus } from "@/lib/runtime/eventBus";

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface WorkflowTask {
  id: string;
  name: string;
  agentId: string;
  execute: () => Promise<unknown>;
}

export interface WorkflowResult {
  status: WorkflowStatus;
  completedTasks: string[];
  failedTask?: string;
  error?: string;
}

export class WorkflowEngine {
  async execute(tasks: WorkflowTask[]): Promise<WorkflowResult> {
    const completedTasks: string[] = [];

    klynEventBus.emit("workflow.started", {
      taskCount: tasks.length,
    });

    try {
      for (const task of tasks) {
        klynEventBus.emit("workflow.task.started", {
          taskId: task.id,
          agentId: task.agentId,
        });

        try {
          await task.execute();
          completedTasks.push(task.id);

          klynEventBus.emit("workflow.task.completed", {
            taskId: task.id,
          });
        } catch (error) {
          klynEventBus.emit("workflow.task.failed", {
            taskId: task.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });

          return {
            status: "failed",
            completedTasks,
            failedTask: task.id,
            error: error instanceof Error ? error.message : "Task failed",
          };
        }
      }

      klynEventBus.emit("workflow.completed", {
        completedTasks,
      });

      return {
        status: "completed",
        completedTasks,
      };
    } catch (error) {
      return {
        status: "failed",
        completedTasks,
        error: error instanceof Error ? error.message : "Workflow failure",
      };
    }
  }
}

export const workflowEngine = new WorkflowEngine();
