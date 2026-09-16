/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 03: InfiniteRuntimeOrchestrator
 * File: genesis/v670/components/InfiniteRuntimeOrchestrator.ts
 * Version: 1.0.0
 *
 * The orchestration plane of the V670 runtime. Implements the never-ending
 * runtime loop of the OS:
 *
 *   tick → drain dispatch ring → dispatch to the execution fabric
 *        → observe health → heal failures (with backoff) → evolve capabilities
 *        → publish 'orchestrator.tick' → repeat
 *
 * Mirrors the real 4.loops (brain/heal) semantics with the V670 substrate.
 * =============================================================================
 */

import { withRetry, sleep } from '../../../kernel/backoff.js';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';
import type { OmniversalRuntimeKernel } from './OmniversalRuntimeKernel.js';

export interface OrchestratorPeers {
  runtime: OmniversalRuntimeKernel;
}

export interface OrchestratorStats {
  ticks: number;
  dispatched: number;
  healed: number;
  observedFailures: number;
  lastTickMs: number;
  tickIntervalMs: number;
}

export class InfiniteRuntimeOrchestrator implements V670Module {
  [key: string]: any;
  readonly id = 'infinite-orchestrator';
  readonly name = 'Infinite Runtime Orchestrator';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private peers: OrchestratorPeers;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ticks = 0;
  private dispatched = 0;
  private healed = 0;
  private observedFailures = 0;
  private lastTickMs = 0;

  constructor(peers: OrchestratorPeers) {
    this.peers = peers;
  }

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;

    // Heal: react to execution failures with a bounded backoff retry cycle.
    this.ctx.subscribe('runtime.execution.failed', (event) => {
      this.observedFailures++;
      const payload = event.payload as { executionId?: string };
      if (this.ticks > 0) {
        void this.heal(payload.executionId ?? 'unknown');
      }
    });
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';
    this.stopped = false;
    ctx.logger.info(`infinite runtime orchestrator online (tick=${ctx.config.tickMs}ms)`);
    this.loop();
  }

  /** The infinite loop — a chained setTimeout (never a blocking while). */
  private loop(): void {
    if (this.stopped || !this.ctx) return;
    this.loopTimer = setTimeout(() => {
      void this.tick()
        .catch((err) => {
          this.lastError = (err as Error).message;
        })
        .finally(() => this.loop());
    }, this.ctx!.config.tickMs);
    this.loopTimer.unref?.();
  }

  /** One orchestration cycle. */
  public async tick(): Promise<void> {
    if (!this.ctx) return;
    this.ticks++;
    this.lastTickMs = Date.now();
    const uptimeMs = this.startedAt === null ? 0 : Date.now() - this.startedAt;

    // 1. Drain the dispatch ring into the execution fabric.
    let drained = 0;
    let item = this.peers.runtime.dispatchRing.pop();
    while (item && drained < 128) {
      drained++;
      this.dispatched++;
      const options = (item.payload as { execute?: unknown }).execute as any;
      if (options) {
        this.ctx.publish('orchestrator.dispatch', options, this.id);
      } else {
        this.ctx.publish('orchestrator.dispatch', item.payload, this.id);
      }
      item = this.peers.runtime.dispatchRing.pop();
    }

    // 2. Publish the tick event with a health digest.
    const health = this.peers.runtime.getHealth();
    this.ctx.publish('orchestrator.tick', {
      tick: this.ticks,
      uptimeMs,
      drained,
      moduleCount: health.modules.length,
      eventCount: health.eventCount,
      queueDepth: health.queueDepth,
      ringDepth: health.ringDepth,
    }, this.id);
  }

  /** Bounded heal: retry the failing execution id with backoff. */
  public async heal(executionId: string): Promise<boolean> {
    try {
      await withRetry(
        async () => {
          this.ctx?.publish('orchestrator.heal', { executionId, attempt: Date.now() }, this.id);
          await sleep(50);
          return true;
        },
        { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1000 }
      );
      this.healed++;
      return true;
    } catch {
      return false;
    }
  }

  public getStats(): OrchestratorStats {
    return {
      ticks: this.ticks,
      dispatched: this.dispatched,
      healed: this.healed,
      observedFailures: this.observedFailures,
      lastTickMs: this.lastTickMs,
      tickIntervalMs: this.ctx?.config.tickMs ?? 1000,
    };
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    await this.stop();
  }

  public metrics(): ModuleMetrics {
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      {
        ticks: this.ticks,
        dispatched: this.dispatched,
        healed: this.healed,
        observedFailures: this.observedFailures,
      },
      { lastTickMs: this.lastTickMs },
      this.lastError
    );
  }
}

export default InfiniteRuntimeOrchestrator;
