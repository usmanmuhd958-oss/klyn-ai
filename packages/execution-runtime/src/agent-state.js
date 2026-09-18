export class InMemoryAgentEventStore {
    events = new Map();
    states = new Map();
    lock = Promise.resolve();
    async append(input) {
        return this.withLock(() => {
            const key = `${input.treeId}:${input.agentId}`;
            const events = this.events.get(key) ?? [];
            const event = { ...input, id: crypto.randomUUID(), sequence: events.length + 1, timestamp: Date.now() };
            events.push(event);
            this.events.set(key, events);
            return event;
        });
    }
    async read(treeId, agentId) {
        const values = [];
        for (const [key, events] of this.events)
            if (key.startsWith(`${treeId}:`) && (!agentId || key === `${treeId}:${agentId}`))
                values.push(...events);
        return values.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
    }
    async snapshot(treeId, agentId) {
        return this.states.get(`${treeId}:${agentId}`) ?? { treeId, agentId, values: {}, version: 0 };
    }
    async setValue(treeId, agentId, key, value) {
        return this.withLock(() => {
            const stateKey = `${treeId}:${agentId}`;
            const previous = this.states.get(stateKey) ?? { treeId, agentId, values: {}, version: 0 };
            const next = { ...previous, values: { ...previous.values, [key]: value }, version: previous.version + 1 };
            this.states.set(stateKey, next);
            return next;
        });
    }
    async withLock(operation) {
        const previous = this.lock;
        let release;
        this.lock = new Promise((resolve) => { release = resolve; });
        await previous;
        try {
            return operation();
        }
        finally {
            release();
        }
    }
}
export class AgentContext {
    treeId;
    agentId;
    store;
    hooks;
    constructor(treeId, agentId, store, hooks = {}) {
        this.treeId = treeId;
        this.agentId = agentId;
        this.store = store;
        this.hooks = hooks;
    }
    async set(key, value) { return this.store.setValue(this.treeId, this.agentId, key, value); }
    async getState() { return this.store.snapshot(this.treeId, this.agentId); }
    async emit(type, payload) {
        const event = await this.store.append({ treeId: this.treeId, agentId: this.agentId, type, payload });
        await this.hooks.onEvent?.(event);
        if (type === "token")
            await this.hooks.onToken?.(event);
        return event;
    }
}
//# sourceMappingURL=agent-state.js.map