import type { AgentEvent, AgentEventStore, AgentState } from "./agent-state.js";
export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export interface DurableTask<T = unknown> {
    readonly id: string;
    readonly idempotencyKey: string;
    readonly payload: T;
    readonly status: TaskStatus;
    readonly attempts: number;
    readonly recoveryCount: number;
    readonly workerId?: string;
    readonly fencingToken?: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly leaseUntil?: number;
    readonly error?: string;
}
export interface EnqueueTaskInput<T = unknown> {
    readonly id?: string;
    readonly idempotencyKey: string;
    readonly payload: T;
}
export declare class SqliteAgentEventStore implements AgentEventStore {
    private readonly db;
    private lock;
    private closed;
    private constructor();
    static open(path: string): Promise<SqliteAgentEventStore>;
    append<T>(input: Omit<AgentEvent<T>, "id" | "sequence" | "timestamp">): Promise<AgentEvent<T>>;
    read(treeId: string, agentId?: string): Promise<readonly AgentEvent[]>;
    snapshot(treeId: string, agentId: string): Promise<AgentState>;
    replay(treeId: string, agentId: string): Promise<AgentState>;
    setValue(treeId: string, agentId: string, key: string, value: unknown): Promise<AgentState>;
    enqueueTask<T>(input: EnqueueTaskInput<T>): Promise<DurableTask<T>>;
    claimPendingTask<T>(workerId: string, leaseMs?: number): Promise<DurableTask<T> | undefined>;
    heartbeatTask(taskId: string, workerId: string, fencingToken: number, leaseMs?: number): Promise<DurableTask | undefined>;
    reapExpiredLeases(now?: number): Promise<number>;
    completeTask(taskId: string): Promise<DurableTask | undefined>;
    failTask(taskId: string, error: string): Promise<DurableTask | undefined>;
    completeTaskFenced(taskId: string, workerId: string, fencingToken: number): Promise<DurableTask | undefined>;
    failTaskFenced(taskId: string, workerId: string, fencingToken: number, error: string): Promise<DurableTask | undefined>;
    recoverPendingTasks(): Promise<number>;
    getTask<T = unknown>(taskId: string): Promise<DurableTask<T> | undefined>;
    close(): Promise<void>;
    private initialize;
    private ensureFencingColumn;
    private transaction;
    private nextSequence;
    private insert;
    private snapshotSync;
    private get;
    private all;
    private getTaskRow;
    private getTaskByIdempotency;
    private mapTask;
    private transitionTask;
    private transitionFenced;
    private toEvent;
    private ensureOpen;
    private withLock;
}
export declare class SqliteEventStoreFactory {
    readonly kind: "sqlite";
    open(path: string): Promise<AgentEventStore>;
}
//# sourceMappingURL=sqlite-event-store.d.ts.map