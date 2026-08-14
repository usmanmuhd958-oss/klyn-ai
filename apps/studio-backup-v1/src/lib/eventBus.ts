import type { SwarmEvent } from "@klyn/agent-runtime";

export interface BusEvents {
  "swarm:event": SwarmEvent;
  "diff:accepted": { nodeId: string };
  "diff:rejected": { nodeId: string };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private map = new Map<string, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(event: K, fn: Handler<BusEvents[K]>): () => void {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn as Handler<never>);
    return () => this.map.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.map.get(event)?.forEach((fn) => (fn as Handler<BusEvents[K]>)(payload));
  }
}

export const bus = new EventBus();
