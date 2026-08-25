import { websocketServer } from "./websocketServer";
import { klynEventBus } from "@/lib/runtime/eventBus";

export interface GatewayEvent {
  workspaceId: string;
  event: string;
  payload: unknown;
}

class RealtimeGateway {
  initialize() {
    const events = [
      "agent.started",
      "agent.completed",
      "agent.failed",
      "artifact.generated",
      "workflow.task.started",
      "workflow.task.completed",
      "runtime.state.changed",
    ];

    for (const event of events) {
      klynEventBus.on(event, (payload: any) => {
        if (!payload?.workspaceId) {
          return;
        }

        this.broadcast({
          workspaceId: payload.workspaceId,
          event,
          payload,
        });
      });
    }
  }

  broadcast(event: GatewayEvent) {
    websocketServer.broadcast(event.workspaceId, {
      type: event.event,
      payload: event.payload,
    });
  }

  sendAgentStream(workspaceId: string, data: unknown) {
    this.broadcast({
      workspaceId,
      event: "agent.stream",
      payload: data,
    });
  }
}

export const realtimeGateway = new RealtimeGateway();
