import { Worker } from "bullmq";
import { redis } from "@/lib/queue/redis";
import { AGENT_QUEUE_NAME, AgentJobPayload } from "@/lib/queue/agentQueue";
import { agentExecutor } from "@/lib/ai/agentExecutor";
import { observability } from "@/lib/ai/observability";
import { klynEventBus } from "@/lib/runtime/eventBus";

export const agentWorker = new Worker<AgentJobPayload>(
  AGENT_QUEUE_NAME,
  async (job) => {
    const data = job.data;

    klynEventBus.emit("agent.worker.started", {
      jobId: job.id,
      agentId: data.agentId,
    });

    try {
      const result = await agentExecutor.execute({
        agentId: data.agentId,
        workspaceId: data.workspaceId,
        userId: data.userId,
        instruction: data.instruction,
        action: data.action,
      });

      observability.info(
        data.workspaceId,
        "agent-worker",
        "Agent execution completed",
        {
          agentId: data.agentId,
          success: result.success,
        }
      );

      klynEventBus.emit("agent.worker.completed", {
        jobId: job.id,
        result,
      });

      return result;
    } catch (error) {
      observability.error(
        data.workspaceId,
        "agent-worker",
        "Agent execution failed",
        {
          agentId: data.agentId,
          error: error instanceof Error ? error.message : "unknown",
        }
      );

      klynEventBus.emit("agent.worker.failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "unknown",
      });

      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

agentWorker.on("ready", () => {
  console.log("Klyn Agent Worker online");
});

agentWorker.on("error", (error) => {
  console.error("Klyn Worker Error", error);
});
