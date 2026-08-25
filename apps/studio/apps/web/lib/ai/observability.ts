export type AuditLevel = "info" | "warning" | "error" | "security";

export interface AuditEvent {
  id: string;
  workspaceId: string;
  level: AuditLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

class ObservabilityService {
  private events: AuditEvent[] = [];

  log(event: Omit<AuditEvent, "id" | "timestamp">) {
    const record: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...event,
    };

    this.events.push(record);
    return record;
  }

  info(
    workspaceId: string,
    source: string,
    message: string,
    metadata?: Record<string, unknown>
  ) {
    return this.log({
      workspaceId,
      level: "info",
      source,
      message,
      metadata,
    });
  }

  warning(workspaceId: string, source: string, message: string) {
    return this.log({
      workspaceId,
      level: "warning",
      source,
      message,
    });
  }

  error(
    workspaceId: string,
    source: string,
    message: string,
    metadata?: Record<string, unknown>
  ) {
    return this.log({
      workspaceId,
      level: "error",
      source,
      message,
      metadata,
    });
  }

  security(
    workspaceId: string,
    message: string,
    metadata?: Record<string, unknown>
  ) {
    return this.log({
      workspaceId,
      level: "security",
      source: "security-engine",
      message,
      metadata,
    });
  }

  query(workspaceId: string) {
    return this.events.filter((event) => event.workspaceId === workspaceId);
  }

  clear() {
    this.events = [];
  }
}

export const observability = new ObservabilityService();
