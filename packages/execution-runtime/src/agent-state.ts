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

export class InMemoryAgentEventStore implements AgentEventStore {
  private readonly events = new Map<string, AgentEvent[]>();
  private readonly states = new Map<string, AgentState>();
  private lock: Promise<void> = Promise.resolve();

  async append<T>(input: Omit<AgentEvent<T>, "id" | "sequence" | "timestamp">): Promise<AgentEvent<T>> {
    return this.withLock(() => {
      const key = `${input.treeId}:${input.agentId}`;
      const events = this.events.get(key) ?? [];
      const event: AgentEvent<T> = { ...input, id: crypto.randomUUID(), sequence: events.length + 1, timestamp: Date.now() };
      events.push(event as AgentEvent);
      this.events.set(key, events);
      return event;
    });
  }

  async read(treeId: string, agentId?: string): Promise<readonly AgentEvent[]> {
    const values: AgentEvent[] = [];
    for (const [key, events] of this.events) if (key.startsWith(`${treeId}:`) && (!agentId || key === `${treeId}:${agentId}`)) values.push(...events);
    return values.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
  }

  async snapshot(treeId: string, agentId: string): Promise<AgentState> {
    return this.states.get(`${treeId}:${agentId}`) ?? { treeId, agentId, values: {}, version: 0 };
  }

  async setValue(treeId: string, agentId: string, key: string, value: unknown): Promise<AgentState> {
    return this.withLock(() => {
      const stateKey = `${treeId}:${agentId}`;
      const previous = this.states.get(stateKey) ?? { treeId, agentId, values: {}, version: 0 };
      const next: AgentState = { ...previous, values: { ...previous.values, [key]: value }, version: previous.version + 1 };
      this.states.set(stateKey, next);
      return next;
    });
  }

  private async withLock<T>(operation: () => T): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return operation(); } finally { release(); }
  }
}

export class AgentContext {
  constructor(
    readonly treeId: string,
    readonly agentId: string,
    private readonly store: AgentEventStore,
    private readonly hooks: AgentStreamHooks = {},
  ) {}

  async set(key: string, value: unknown): Promise<AgentState> { return this.store.setValue(this.treeId, this.agentId, key, value); }
  async getState(): Promise<AgentState> { return this.store.snapshot(this.treeId, this.agentId); }

  async emit<T>(type: AgentEventType, payload: T): Promise<AgentEvent<T>> {
    const event = await this.store.append({ treeId: this.treeId, agentId: this.agentId, type, payload });
    await this.hooks.onEvent?.(event);
    if (type === "token") await this.hooks.onToken?.(event as AgentEvent<string>);
    return event;
  }
}

export interface PersistentEventStoreFactory {
  readonly kind: "sqlite";
  open(path: string): Promise<AgentEventStore>;
}
