import type { DurableTask, EnqueueTaskInput, SqliteAgentEventStore } from "./sqlite-event-store.js";

export interface HeartbeatRequest { readonly workerId: string; readonly taskId: string; readonly fencingToken: number; readonly leaseMs?: number; }
export interface LeaseSchedulerOptions { readonly defaultLeaseMs?: number; readonly reaperIntervalMs?: number; }

export class LeaseScheduler {
  readonly workerId: string;
  private readonly leaseMs: number;
  private readonly reaperIntervalMs: number;
  private reaper?: ReturnType<typeof setInterval>;
  constructor(private readonly store: SqliteAgentEventStore, workerId: string, options: LeaseSchedulerOptions = {}) {
    if (!workerId.trim()) throw new Error("workerId is required");
    this.workerId = workerId;
    this.leaseMs = Math.max(1, Math.floor(options.defaultLeaseMs ?? 30_000));
    this.reaperIntervalMs = Math.max(10, Math.floor(options.reaperIntervalMs ?? Math.max(10, Math.floor(this.leaseMs / 3))));
  }
  enqueue<T>(input: EnqueueTaskInput<T>): Promise<DurableTask<T>> { return this.store.enqueueTask(input); }
  claim<T = unknown>(): Promise<DurableTask<T> | undefined> { return this.store.claimPendingTask<T>(this.workerId, this.leaseMs); }
  heartbeat(input: Omit<HeartbeatRequest, "workerId">): Promise<DurableTask | undefined> { return this.store.heartbeatTask(input.taskId, this.workerId, input.fencingToken, input.leaseMs ?? this.leaseMs); }
  complete(task: Pick<DurableTask, "id" | "fencingToken">): Promise<DurableTask | undefined> { if (task.fencingToken === undefined) throw new Error("A fencing token is required for distributed completion"); return this.store.completeTaskFenced(task.id, this.workerId, task.fencingToken); }
  fail(task: Pick<DurableTask, "id" | "fencingToken">, error: string): Promise<DurableTask | undefined> { if (task.fencingToken === undefined) throw new Error("A fencing token is required for distributed failure"); return this.store.failTaskFenced(task.id, this.workerId, task.fencingToken, error); }
  startReaper(): void { if (this.reaper) return; this.reaper = setInterval(() => { void this.store.reapExpiredLeases(); }, this.reaperIntervalMs); this.reaper.unref?.(); }
  async reapNow(now = Date.now()): Promise<number> { return this.store.reapExpiredLeases(now); }
  stopReaper(): void { if (!this.reaper) return; clearInterval(this.reaper); this.reaper = undefined; }
  async close(): Promise<void> { this.stopReaper(); }
}

export class WorkerHeartbeat {
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly scheduler: LeaseScheduler, private readonly intervalMs = 10_000) {}
  start(task: Pick<DurableTask, "id" | "fencingToken">): void { if (task.fencingToken === undefined) throw new Error("A fencing token is required for heartbeat"); this.stop(); const token = task.fencingToken; const tick = () => { void this.scheduler.heartbeat({ taskId: task.id, fencingToken: token }); }; this.timer = setInterval(tick, Math.max(10, this.intervalMs)); this.timer.unref?.(); }
  stop(): void { if (!this.timer) return; clearInterval(this.timer); this.timer = undefined; }
}

export class LeaseReaper { constructor(private readonly scheduler: LeaseScheduler) {} runOnce(now = Date.now()): Promise<number> { return this.scheduler.reapNow(now); } }
