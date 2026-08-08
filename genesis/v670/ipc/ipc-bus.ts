/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Omniversal Event Bus (in-process)
 * File: genesis/v670/ipc/ipc-bus.ts
 * Version: 1.0.0
 *
 * The V670 in-process event bus:
 *   - Typed handlers, wildcard ('*') subscription, priority ordering.
 *   - In-process request/reply with correlation and timeout.
 *   - Ring-bounded history for diagnostics.
 *   - Optional bridge into the 0.kernel KernelEventBus for system events.
 * =============================================================================
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RingBuffer } from './ring-buffer.js';
import type { BusEvent } from '../types.js';

export interface BusHandler {
  (event: BusEvent): void | Promise<void>;
}

export interface BusSubscription {
  id: string;
  type: string;
  handler: BusHandler;
  priority: number;
}

export interface BusMetrics {
  totalEvents: number;
  handlerCount: number;
  historySize: number;
  ringDepth: number;
  pendingReplies: number;
  eventsByType: Record<string, number>;
}

export interface V670BusOptions {
  historyCapacity?: number;
  /** Optional bridge callback forwarding system events to the 0.kernel bus. */
  bridge?: (type: string, payload: unknown, source: string, correlationId?: string) => void;
}

export class V670Bus extends EventEmitter {
  [key: string]: any;
  private subscriptions = new Map<string, BusSubscription>();
  private history = new RingBuffer<BusEvent>({ capacity: 1000, overwrite: true });
  private byType = new Map<string, number>();
  private replyWaiters = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private totalEvents = 0;
  private bridge: V670BusOptions['bridge'];
  private seq = 0;

  constructor(options: V670BusOptions = {}) {
    super();
    this.setMaxListeners(200);
    this.history = new RingBuffer<BusEvent>({ capacity: options.historyCapacity ?? 1000, overwrite: true });
    this.bridge = options.bridge;
  }

  /**
   * Subscribe to an event type (or '*'). Returns an unsubscribe function.
   */
  public subscribe(type: string, handler: BusHandler, priority = 0): () => void {
    const id = `sub_${++this.seq}_${Date.now()}`;
    this.subscriptions.set(id, { id, type, handler, priority });
    return () => {
      this.subscriptions.delete(id);
    };
  }

  /** Await the next event of a type (subscribe-once). */
  public waitFor(type: string, timeoutMs = 30_000): Promise<BusEvent> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsub = this.subscribe(type, (event) => {
        unsub();
        if (timer) clearTimeout(timer);
        resolve(event);
      });
      timer = setTimeout(() => {
        unsub();
        resolve({ id: 'timeout', type, payload: null, source: 'bus', correlationId: null, timestamp: Date.now() });
      }, timeoutMs);
    });
  }

  /** Publish an event. Returns the number of handlers invoked. */
  public publish(type: string, payload: unknown, source = 'v670', correlationId?: string): number {
    const event: BusEvent = {
      id: `evt_${++this.seq}_${Date.now()}`,
      type,
      payload,
      source,
      correlationId: correlationId ?? null,
      timestamp: Date.now(),
    };

    this.totalEvents++;
    this.byType.set(type, (this.byType.get(type) ?? 0) + 1);
    this.history.push(event);

    if (this.bridge) {
      try {
        this.bridge(type, payload, source, correlationId);
      } catch {
        /* bridge must never break the bus */
      }
    }

    const handlers = Array.from(this.subscriptions.values())
      .filter((s) => s.type === type || s.type === '*')
      .sort((a, b) => a.priority - b.priority);

    for (const subscription of handlers) {
      try {
        const result = subscription.handler(event);
        if (result instanceof Promise) {
          void result.catch(() => {});
        }
      } catch {
        /* handler isolation */
      }
    }

    return handlers.length;
  }

  /** In-process request/reply with correlation and timeout. */
  public request(type: string, payload: unknown, timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const correlationId = randomUUID();
      const event: BusEvent = {
        id: `req_${++this.seq}_${Date.now()}`,
        type,
        payload,
        source: 'v670-request',
        correlationId,
        timestamp: Date.now(),
      };

      const timer = setTimeout(() => {
        this.replyWaiters.delete(correlationId);
        reject(new Error(`Bus request '${type}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.replyWaiters.set(correlationId, { resolve, reject, timer });

      this.totalEvents++;
      this.byType.set(type, (this.byType.get(type) ?? 0) + 1);
      this.history.push(event);

      const handlers = Array.from(this.subscriptions.values())
        .filter((s) => s.type === type || s.type === '*')
        .sort((a, b) => a.priority - b.priority);

      for (const subscription of handlers) {
        try {
          const result = subscription.handler(event);
          if (result instanceof Promise) {
            void result.catch(() => {});
          }
        } catch {
          /* isolated */
        }
      }
    });
  }

  /** Reply to an in-process request. */
  public replyTo(event: BusEvent, payload: unknown): boolean {
    if (!event.correlationId) return false;
    const waiter = this.replyWaiters.get(event.correlationId);
    if (!waiter) return false;
    this.replyWaiters.delete(event.correlationId);
    clearTimeout(waiter.timer);
    waiter.resolve(payload);
    return true;
  }

  public getMetrics(): BusMetrics {
    return {
      totalEvents: this.totalEvents,
      handlerCount: this.subscriptions.size,
      historySize: this.history.depth,
      ringDepth: this.history.depth,
      pendingReplies: this.replyWaiters.size,
      eventsByType: Object.fromEntries(this.byType),
    };
  }

  public getHistory(): BusEvent[] {
    return this.history.toArray().reverse();
  }

  public clearHistory(): void {
    this.history.clear();
  }

  public dispose(): void {
    for (const waiter of this.replyWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Bus disposed'));
    }
    this.replyWaiters.clear();
    this.subscriptions.clear();
    this.removeAllListeners();
  }
}

export default V670Bus;
