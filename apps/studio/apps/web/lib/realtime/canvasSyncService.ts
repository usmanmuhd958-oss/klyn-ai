import { realtimeGateway } from "./realtimeGateway";

export type CanvasOperation =
  | "node.created"
  | "node.updated"
  | "node.deleted"
  | "edge.created"
  | "edge.deleted";

export interface CanvasMutation {
  workspaceId: string;
  userId: string;
  operation: CanvasOperation;
  data: unknown;
  timestamp: number;
}

class CanvasSyncService {
  async publish(mutation: CanvasMutation) {
    const event = {
      workspaceId: mutation.workspaceId,
      event: "canvas.mutation",
      payload: {
        ...mutation,
        timestamp: Date.now(),
      },
    };

    realtimeGateway.broadcast(event);
  }

  async nodeCreated(params: {
    workspaceId: string;
    userId: string;
    node: unknown;
  }) {
    return this.publish({
      workspaceId: params.workspaceId,
      userId: params.userId,
      operation: "node.created",
      data: params.node,
      timestamp: Date.now(),
    });
  }

  async nodeUpdated(params: {
    workspaceId: string;
    userId: string;
    node: unknown;
  }) {
    return this.publish({
      workspaceId: params.workspaceId,
      userId: params.userId,
      operation: "node.updated",
      data: params.node,
      timestamp: Date.now(),
    });
  }

  async edgeCreated(params: {
    workspaceId: string;
    userId: string;
    edge: unknown;
  }) {
    return this.publish({
      workspaceId: params.workspaceId,
      userId: params.userId,
      operation: "edge.created",
      data: params.edge,
      timestamp: Date.now(),
    });
  }
}

export const canvasSyncService = new CanvasSyncService();
