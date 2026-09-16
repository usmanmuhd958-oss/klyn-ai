/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Scheduler
 * File: 1.brain/scheduler.ts
 * Version: 1.0.0
 *
 * Dependency-free task scheduler supporting:
 *   - One-shot scheduling (delay).
 *   - Recurring interval scheduling.
 *   - Priority ordering for due tasks.
 *   - Cancellation and stats.
 * =============================================================================
 */

export type SchedulerPriority = 'low' | 'normal' | 'high' | 'critical';

export interface ScheduledTask {
  id: string;
  name: string;
  runAt: number;
  intervalMs: number | null;
  priority: number;
  handler: () => Promise<void> | void;
  runs: number;
  lastRunAt: number | null;
  lastError: string | null;
}

export interface SchedulerStats {
  pending: number;
  totalRuns: number;
  totalErrors: number;
  cancelled: number;
}

const PRIORITY_ORDER: Record<SchedulerPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

let schedulerSeq = 0;

export class Scheduler {
  [key: string]: any;
  private tasks = new Map<string, ScheduledTask>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private totalRuns = 0;
  private totalErrors = 0;
  private cancelled = 0;

  constructor(private tickMs = 50) {}

  /** Schedule a one-shot task. Returns task id. */
  public schedule(
    name: string,
    handler: () => Promise<void> | void,
    delayMs: number,
    priority: SchedulerPriority = 'normal'
  ): string {
    const id = `task_${++schedulerSeq}_${Date.now()}`;
    this.tasks.set(id, {
      id,
      name,
      runAt: Date.now() + Math.max(0, delayMs),
      intervalMs: null,
      priority: PRIORITY_ORDER[priority],
      handler,
      runs: 0,
      lastRunAt: null,
      lastError: null,
    });
    this.ensureLoop();
    return id;
  }

  /** Schedule a recurring task. Returns task id. */
  public interval(
    name: string,
    handler: () => Promise<void> | void,
    intervalMs: number,
    priority: SchedulerPriority = 'normal'
  ): string {
    const id = `task_${++schedulerSeq}_${Date.now()}`;
    this.tasks.set(id, {
      id,
      name,
      runAt: Date.now() + Math.max(1, intervalMs),
      intervalMs: Math.max(1, intervalMs),
      priority: PRIORITY_ORDER[priority],
      handler,
      runs: 0,
      lastRunAt: null,
      lastError: null,
    });
    this.ensureLoop();
    return id;
  }

  public cancel(id: string): boolean {
    const removed = this.tasks.delete(id);
    if (removed) this.cancelled++;
    return removed;
  }

  public get(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  public pendingCount(): number {
    return this.tasks.size;
  }

  public getStats(): SchedulerStats {
    return {
      pending: this.tasks.size,
      totalRuns: this.totalRuns,
      totalErrors: this.totalErrors,
      cancelled: this.cancelled,
    };
  }

  public async drain(): Promise<void> {
    const now = Date.now();
    const due: ScheduledTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.runAt <= now) due.push(task);
    }
    due.sort((a, b) => a.priority - b.priority);

    for (const task of due) {
      if (!this.tasks.has(task.id)) continue;
      this.totalRuns++;
      task.runs++;
      task.lastRunAt = Date.now();
      try {
        await task.handler();
      } catch (err) {
        this.totalErrors++;
        task.lastError = (err as Error).message;
      }
      if (task.intervalMs === null) {
        this.tasks.delete(task.id);
      } else {
        task.runAt = Date.now() + task.intervalMs;
      }
    }
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.tasks.clear();
  }

  private ensureLoop(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await this.drain();
      if (!this.running) break;
      await sleep(this.tickMs);
    }
    this.timer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default Scheduler;
