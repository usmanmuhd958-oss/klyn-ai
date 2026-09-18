export class LeaseScheduler {
    store;
    workerId;
    leaseMs;
    reaperIntervalMs;
    reaper;
    constructor(store, workerId, options = {}) {
        this.store = store;
        if (!workerId.trim())
            throw new Error("workerId is required");
        this.workerId = workerId;
        this.leaseMs = Math.max(1, Math.floor(options.defaultLeaseMs ?? 30_000));
        this.reaperIntervalMs = Math.max(10, Math.floor(options.reaperIntervalMs ?? Math.max(10, Math.floor(this.leaseMs / 3))));
    }
    enqueue(input) { return this.store.enqueueTask(input); }
    claim() { return this.store.claimPendingTask(this.workerId, this.leaseMs); }
    heartbeat(input) { return this.store.heartbeatTask(input.taskId, this.workerId, input.fencingToken, input.leaseMs ?? this.leaseMs); }
    complete(task) { if (task.fencingToken === undefined)
        throw new Error("A fencing token is required for distributed completion"); return this.store.completeTaskFenced(task.id, this.workerId, task.fencingToken); }
    fail(task, error) { if (task.fencingToken === undefined)
        throw new Error("A fencing token is required for distributed failure"); return this.store.failTaskFenced(task.id, this.workerId, task.fencingToken, error); }
    startReaper() { if (this.reaper)
        return; this.reaper = globalThis.setInterval(() => { void this.store.reapExpiredLeases(); }, this.reaperIntervalMs); this.reaper.unref?.(); }
    async reapNow(now = Date.now()) { return this.store.reapExpiredLeases(now); }
    stopReaper() { if (!this.reaper)
        return; globalThis.clearInterval(this.reaper); this.reaper = undefined; }
    async close() { this.stopReaper(); }
}
export class WorkerHeartbeat {
    scheduler;
    intervalMs;
    timer;
    constructor(scheduler, intervalMs = 10_000) {
        this.scheduler = scheduler;
        this.intervalMs = intervalMs;
    }
    start(task) { if (task.fencingToken === undefined)
        throw new Error("A fencing token is required for heartbeat"); this.stop(); const token = task.fencingToken; const tick = () => { void this.scheduler.heartbeat({ taskId: task.id, fencingToken: token }); }; this.timer = globalThis.setInterval(tick, Math.max(10, this.intervalMs)); this.timer.unref?.(); }
    stop() { if (!this.timer)
        return; globalThis.clearInterval(this.timer); this.timer = undefined; }
}
export class LeaseReaper {
    scheduler;
    constructor(scheduler) {
        this.scheduler = scheduler;
    }
    runOnce(now = Date.now()) { return this.scheduler.reapNow(now); }
}
//# sourceMappingURL=lease-scheduler.js.map