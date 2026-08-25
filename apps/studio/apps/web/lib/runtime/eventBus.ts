export type KlynEventType =
  | "intent.created"
  | "mission.started"
  | "mission.completed"
  | "agent.started"
  | "agent.thinking"
  | "agent.executing"
  | "agent.completed"
  | "agent.error"
  | "artifact.generated"
  | "node.created"
  | "node.updated"
  | "edge.created"
  | "verification.completed";

export interface KlynEvent {
  type: KlynEventType;
  payload: unknown;
  timestamp: number;
}

type EventListener = (event: KlynEvent) => void;

class KlynEventBus {
  private listeners: Map<KlynEventType, EventListener[]>;

  constructor() {
    this.listeners = new Map();
  }

  on(type: KlynEventType, listener: EventListener) {
    const existing = this.listeners.get(type) || [];
    this.listeners.set(type, [...existing, listener]);
  }

  off(type: KlynEventType, listener: EventListener) {
    const existing = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      existing.filter((item) => item !== listener)
    );
  }

  emit(type: KlynEventType, payload: unknown) {
    const event: KlynEvent = {
      type,
      payload,
      timestamp: Date.now(),
    };

    const listeners = this.listeners.get(type) || [];
    listeners.forEach((listener) => listener(event));
  }
}

export const klynEventBus = new KlynEventBus();
