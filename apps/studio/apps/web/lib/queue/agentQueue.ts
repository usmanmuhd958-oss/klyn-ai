import { Queue, QueueEvents } from "bullmq";
import { redis } from "./redis";

export interface AgentJobPayload {
  missionId: string;
  workspaceId: string;
  userId: string;
  agentId: string;
  instruction: string;
  action: string;
}

export const AGENT_QUEUE_NAME = "klyn-agent-execution";

export const agentQueue = new Queue<AgentJobPayload>(AGENT_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

export const agentQueueEvents = new QueueEvents(AGENT_QUEUE_NAME, {
  connection: redis,
});

export async function enqueueAgentTask(payload: AgentJobPayload) {
  return agentQueue.add("execute-agent", payload, {
    priority: 1,
  });
}

agentQueueEvents.on("completed", ({ jobId }) => {
  console.log(`Agent job completed ${jobId}`);
});

agentQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`Agent job failed ${jobId}`, failedReason);
});
