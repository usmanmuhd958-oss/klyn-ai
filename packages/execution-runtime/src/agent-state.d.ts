export type AgentEventType = "started" | "token" | "progress" | "checkpoint" | "completed" | "failed" | "cancelled";
export interface AgentEvent<T = unknown> {
    readonly id: string;
    readonly treeId: string;
    readonly agentId: string;
    readonly sequence: number;
    readonly type: AgentEventType;
    readonly timestamp: number;
    readonly payload: T;
}
export interface AgentState {
    readonly treeId: string;
    readonly agentId: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly version: number;
}
export interface AgentEventStore {
    append<T>(event: Omit<AgentEvent<T>, "id" | "sequence" | "timestamp">): Promise<AgentEvent<T>>;
    read(treeId: string, agentId?: string): Promise<readonly AgentEvent[]>;
    snapshot(treeId: string, agentId: string): Promise<AgentState>;
    setValue(treeId: string, agentId: string, key: string, value: unknown): Promise<AgentState>;
}
export interface AgentStreamHooks {
    onEvent?(event: AgentEvent): void | Promise<void>;
    onToken?(event: AgentEvent<string>): void | Promise<void>;
}
export declare class InMemoryAgentEventStore implements AgentEventStore {
    private readonly events;
    private readonly states;
    private lock;
    append<T>(input: Omit<AgentEvent<T>, "id" | "sequence" | "timestamp">): Promise<AgentEvent<T>>;
    read(treeId: string, agentId?: string): Promise<readonly AgentEvent[]>;
    snapshot(treeId: string, agentId: string): Promise<AgentState>;
    setValue(treeId: string, agentId: string, key: string, value: unknown): Promise<AgentState>;
    private withLock;
}
export declare class AgentContext {
    readonly treeId: string;
    readonly agentId: string;
    private readonly store;
    private readonly hooks;
    constructor(treeId: string, agentId: string, store: AgentEventStore, hooks?: AgentStreamHooks);
    set(key: string, value: unknown): Promise<AgentState>;
    getState(): Promise<AgentState>;
    emit<T>(type: AgentEventType, payload: T): Promise<AgentEvent<T>>;
}
export interface PersistentEventStoreFactory {
    readonly kind: "sqlite";
    open(path: string): Promise<AgentEventStore>;
}
//# sourceMappingURL=agent-state.d.ts.map