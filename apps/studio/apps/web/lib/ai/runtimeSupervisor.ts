import { klynEventBus } from "@/lib/runtime/eventBus";

export type RuntimeState =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "failed"
  | "completed";

export interface RuntimeSession {
  id: string;
  workspaceId: string;
  missionId: string;
  state: RuntimeState;
  startedAt: number;
  updatedAt: number;
}

class RuntimeSupervisor {
  private sessions: Map<string, RuntimeSession> = new Map();

  startSession(params: { workspaceId: string; missionId: string }) {
    const session: RuntimeSession = {
      id: crypto.randomUUID(),
      workspaceId: params.workspaceId,
      missionId: params.missionId,
      state: "starting",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    klynEventBus.emit("runtime.started", session);

    return session;
  }

  updateState(sessionId: string, state: RuntimeState) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error("Runtime session not found");
    }

    session.state = state;
    session.updatedAt = Date.now();

    klynEventBus.emit("runtime.state.changed", session);

    return session;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  getWorkspaceSessions(workspaceId: string) {
    return Array.from(this.sessions.values()).filter(
      (session) => session.workspaceId === workspaceId
    );
  }

  stopSession(sessionId: string) {
    this.sessions.delete(sessionId);
    klynEventBus.emit("runtime.stopped", { sessionId });
  }
}

export const runtimeSupervisor = new RuntimeSupervisor();
