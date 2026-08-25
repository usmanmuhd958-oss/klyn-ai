export type TimelineStatus =
  | "started"
  | "running"
  | "completed"
  | "failed";

export interface TimelineEvent {
  id: string;
  missionId: string;
  message: string;
  status: TimelineStatus;
  timestamp: number;
}

class ExecutionTimeline {
  private events: TimelineEvent[] = [];

  start(missionId: string, message: string) {
    this.events.push({
      id: crypto.randomUUID(),
      missionId,
      message,
      status: "started",
      timestamp: Date.now(),
    });
  }

  add(missionId: string, message: string, status: TimelineStatus) {
    this.events.push({
      id: crypto.randomUUID(),
      missionId,
      message,
      status,
      timestamp: Date.now(),
    });
  }

  complete(missionId: string, status: "completed" | "failed") {
    this.events.push({
      id: crypto.randomUUID(),
      missionId,
      message:
        status === "completed" ? "Mission completed" : "Mission failed",
      status,
      timestamp: Date.now(),
    });
  }

  getMissionTimeline(missionId: string) {
    return this.events.filter((event) => event.missionId === missionId);
  }

  getLatest(limit: number = 20) {
    return this.events.slice(-limit);
  }
}

export const executionTimeline = new ExecutionTimeline();
