/**
 * KLYN AI OS - System Event Bus
 * Central event-driven communication hub
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  KernelEvent,
  EventType,
  EventHandler,
  EventSubscription,
} from './types.ts';

export class KernelEventBus extends EventEmitter {
  [key: string]: any;
  private subscriptions: Map<string, EventSubscription> = new Map();
  private eventHistory: KernelEvent[] = [];
  private maxHistorySize = 1000;
  private metrics = {
    totalEvents: 0,
    eventsByType: new Map<EventType, number>(),
    errors: 0,
  };

  constructor() {
    super();
    this.setMaxListeners(100); // Support many subscribers
  }

  /**
   * Publish event to the bus
   */
  publish(
    type: EventType,
    payload: any,
    source: string,
    correlationId?: string
  ): KernelEvent {
    const event: KernelEvent = {
      id: randomUUID(),
      type,
      timestamp: new Date(),
      source,
      payload,
      correlationId,
    };

    // Store in history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Update metrics
    this.metrics.totalEvents++;
    this.metrics.eventsByType.set(
      type,
      (this.metrics.eventsByType.get(type) || 0) + 1
    );

    // Emit to specific type listeners
    this.emit(type, event);

    // Emit to wildcard listeners
    this.emit('*', event);

    // Log critical events
    if (type.includes('error') || type.includes('failed')) {
      this.metrics.errors++;
      console.error(`[Bus] 🔴 ${type}:`, payload);
    } else if (process.env.DEBUG) {
      console.log(`[Bus] 📡 ${type}:`, payload);
    }

    return event;
  }

  /**
   * Subscribe to events
   */
  subscribe(
    eventType: EventType | '*',
    handler: EventHandler,
    priority = 0
  ): string {
    const subscription: EventSubscription = {
      id: randomUUID(),
      eventType,
      handler,
      priority,
    };

    this.subscriptions.set(subscription.id, subscription);

    // Register with EventEmitter
    this.on(eventType, handler);

    return subscription.id;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return false;

    this.off(subscription.eventType, subscription.handler);
    this.subscriptions.delete(subscriptionId);

    return true;
  }

  /**
   * Get event history
   */
  getHistory(filter?: {
    type?: EventType;
    source?: string;
    since?: Date;
    correlationId?: string;
  }): KernelEvent[] {
    let history = [...this.eventHistory];

    if (filter) {
      if (filter.type) {
        history = history.filter(e => e.type === filter.type);
      }
      if (filter.source) {
        history = history.filter(e => e.source === filter.source);
      }
      if (filter.since) {
        history = history.filter(e => e.timestamp >= filter.since!);
      }
      if (filter.correlationId) {
        history = history.filter(e => e.correlationId === filter.correlationId);
      }
    }

    return history;
  }

  /**
   * Get event chain by correlation ID
   */
  getEventChain(correlationId: string): KernelEvent[] {
    return this.eventHistory
      .filter(e => e.correlationId === correlationId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      eventsByType: Object.fromEntries(this.metrics.eventsByType),
      subscriptionCount: this.subscriptions.size,
      historySize: this.eventHistory.length,
    };
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Wait for specific event
   */
  async waitFor(
    eventType: EventType,
    timeout = 30000,
    filter?: (event: KernelEvent) => boolean
  ): Promise<KernelEvent> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off(eventType, handler);
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeout);

      const handler = (event: KernelEvent) => {
        if (!filter || filter(event)) {
          clearTimeout(timeoutId);
          this.off(eventType, handler);
          resolve(event);
        }
      };

      this.on(eventType, handler);
    });
  }
}

// Global singleton instance
export const kernelBus = new KernelEventBus();
