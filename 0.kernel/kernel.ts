/**
 * =============================================================================
 * KLYN AI OS — Kernel Layer (Layer 0) — Runtime Kernel
 * File: 0.kernel/kernel.ts
 * Version: 2.0.0
 *
 * The low-level runtime kernel. Wraps the system event bus with:
 *   - A typed state registry for kernel services.
 *   - Execution accounting (started/completed/failed).
 *   - Lifecycle hooks (boot, shutdown) and health metrics.
 *
 * This is the pure "runtime-first" substrate that the Genesis V670
 * OmniversalRuntimeKernel builds on.
 * =============================================================================
 */

import { KernelEventBus, kernelBus } from './bus.ts';
import type { EventType, KernelEvent, ExecutionResult } from './types.ts';

export interface KernelStats {
  uptimeMs: number;
  health: 'booting' | 'nominal' | 'degraded' | 'stopped';
  eventCount: number;
  subscriptionCount: number;
  stateSize: number;
  executions: number;
  failures: number;
}

export class Kernel {
  [key: string]: any;
  private bus: KernelEventBus;
  private state = new Map<string, unknown>();
  private startedAt: number | null = null;
  private executions = 0;
  private failures = 0;
  private health: KernelStats['health'] = 'stopped';

  constructor(bus: KernelEventBus = kernelBus) {
    this.bus = bus;
  }

  get eventBus(): KernelEventBus {
    return this.bus;
  }

  /** Boot the kernel: record start time and emit a health event. */
  public boot(): void {
    this.startedAt = Date.now();
    this.health = 'booting';
    this.bus.publish('system.health_check', { status: 'booting', layer: '0.kernel' }, 'kernel');
    this.health = 'nominal';
  }

  /** Publish a typed event onto the system bus. */
  public publish(
    type: EventType,
    payload: unknown,
    source = 'kernel',
    correlationId?: string
  ): KernelEvent {
    return this.bus.publish(type, payload, source, correlationId);
  }

  /** Subscribe to an event type (or '*'). Returns subscription id. */
  public subscribe(type: EventType | '*', handler: (event: KernelEvent) => void): string {
    return this.bus.subscribe(type, handler);
  }

  public unsubscribe(subscriptionId: string): boolean {
    return this.bus.unsubscribe(subscriptionId);
  }

  /** Register a kernel service in the state registry. */
  public registerState(key: string, value: unknown): void {
    this.state.set(key, value);
  }

  public getState<T = unknown>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  /**
   * Account a completed execution and emit the matching runtime event.
   */
  public recordExecution(result: ExecutionResult, executionId: string): KernelEvent {
    this.executions++;
    if (!result.success) this.failures++;

    const type: EventType = result.success
      ? 'runtime.execution.completed'
      : 'runtime.execution.failed';

    return this.bus.publish(type, { executionId, result }, 'kernel', executionId);
  }

  public getStats(): KernelStats {
    const metrics = this.bus.getMetrics();
    return {
      uptimeMs: this.startedAt === null ? 0 : Date.now() - this.startedAt,
      health: this.health,
      eventCount: metrics.totalEvents ?? 0,
      subscriptionCount: metrics.subscriptionCount ?? 0,
      stateSize: this.state.size,
      executions: this.executions,
      failures: this.failures,
    };
  }

  public shutdown(): void {
    this.health = 'stopped';
    this.bus.clearHistory();
  }
}

export default Kernel;
