#!/usr/bin/env bash

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/packages/core-runtime/src/EventBus.ts"

echo "================================="
echo " KLYN EventBus Installer"
echo "================================="

mkdir -p "$(dirname "$TARGET")"

cat > "$TARGET" <<'EOF'
export type KlynEvent = {
  type: string;
  payload?: unknown;
  timestamp: number;
};

export type EventHandler = (event: KlynEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  subscribe(event: string, handler: EventHandler): () => void {
    let set = this.listeners.get(event);

    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    set.add(handler);

    let unsubscribed = false;

    return () => {
      if (unsubscribed) return;

      unsubscribed = true;
      set!.delete(handler);

      if (set!.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  unsubscribe(event: string, handler: EventHandler): boolean {
    const set = this.listeners.get(event);

    if (!set) return false;

    const removed = set.delete(handler);

    if (set.size === 0) {
      this.listeners.delete(event);
    }

    return removed;
  }

  publish(event: KlynEvent): void {
    const set = this.listeners.get(event.type);

    if (!set || set.size === 0) return;

    const handlers = Array.from(set);

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[EventBus] handler for "${event.type}" threw:`, err);
      }
    }
  }

  get activeEventTypes(): number {
    return this.listeners.size;
  }

  get totalListeners(): number {
    let total = 0;

    for (const set of this.listeners.values()) {
      total += set.size;
    }

    return total;
  }
}
EOF

echo "Created:"
ls -lh "$TARGET"

echo "================================="
echo " EventBus installed successfully"
echo "================================="
