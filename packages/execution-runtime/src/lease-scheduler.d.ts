import type { DurableTask, EnqueueTaskInput, SqliteAgentEventStore } from "./sqlite-event-store.js";
export interface HeartbeatRequest {
    readonly workerId: string;
    readonly taskId: string;
    readonly fencingToken: number;
    readonly leaseMs?: number;
}
export interface LeaseSchedulerOptions {
    readonly defaultLeaseMs?: number;
    readonly reaperIntervalMs?: number;
}
export declare class LeaseScheduler {
    private readonly store;
    readonly workerId: string;
    private readonly leaseMs;
    private readonly reaperIntervalMs;
    private reaper?;
    constructor(store: SqliteAgentEventStore, workerId: string, options?: LeaseSchedulerOptions);
    enqueue<T>(input: EnqueueTaskInput<T>): Promise<DurableTask<T>>;
    claim<T = unknown>(): Promise<DurableTask<T> | undefined>;
    heartbeat(input: Omit<HeartbeatRequest, "workerId">): Promise<DurableTask | undefined>;
    complete(task: Pick<DurableTask, "id" | "fencingToken">): Promise<DurableTask | undefined>;
    fail(task: Pick<DurableTask, "id" | "fencingToken">, error: string): Promise<DurableTask | undefined>;
    startReaper(): void;
    reapNow(now?: number): Promise<number>;
    stopReaper(): void;
    close(): Promise<void>;
}
export declare class WorkerHeartbeat {
    private readonly scheduler;
    private readonly intervalMs;
    private timer?;
    constructor(scheduler: LeaseScheduler, intervalMs?: number);
    start(task: Pick<DurableTask, "id" | "fencingToken">): void;
    stop(): void;
}
export declare class LeaseReaper {
    private readonly scheduler;
    constructor(scheduler: LeaseScheduler);
    runOnce(now?: number): Promise<number>;
}
//# sourceMappingURL=lease-scheduler.d.ts.map