import { workflowEngine, WorkflowTask } from "./workflowEngine";
import { agentExecutor } from "./agentExecutor";
import { executionTimeline } from "./executionTimeline";
import { klynEventBus } from "@/lib/runtime/eventBus";

export interface MissionRequest {
  workspaceId: string;
  userId: string;
  intent: string;
}

export interface Mission {
  id: string;
  intent: string;
  tasks: WorkflowTask[];
}

export class MissionOrchestrator {
  createMission(request: MissionRequest): Mission {
    const missionId = crypto.randomUUID();

    const tasks: WorkflowTask[] = [
      {
        id: `${missionId}-architecture`,
        name: "Design system architecture",
        agentId: "architect-agent",
        execute: () =>
          agentExecutor.execute({
            agentId: "architect-agent",
            workspaceId: request.workspaceId,
            userId: request.userId,
            instruction: request.intent,
            action: "architecture.design",
          }),
      },
      {
        id: `${missionId}-build`,
        name: "Generate implementation",
        agentId: "builder-agent",
        execute: () =>
          agentExecutor.execute({
            agentId: "builder-agent",
            workspaceId: request.workspaceId,
            userId: request.userId,
            instruction: request.intent,
            action: "code.generate",
          }),
      },
      {
        id: `${missionId}-review`,
        name: "Review generated output",
        agentId: "reviewer-agent",
        execute: () =>
          agentExecutor.execute({
            agentId: "reviewer-agent",
            workspaceId: request.workspaceId,
            userId: request.userId,
            instruction: request.intent,
            action: "code.review",
          }),
      },
    ];

    return {
      id: missionId,
      intent: request.intent,
      tasks,
    };
  }

  async executeMission(request: MissionRequest) {
    const mission = this.createMission(request);

    executionTimeline.start(mission.id, mission.intent);
    klynEventBus.emit("mission.created", mission);

    const result = await workflowEngine.execute(mission.tasks);
    executionTimeline.complete(mission.id, result.status);

    return result;
  }
}

export const missionOrchestrator = new MissionOrchestrator();
