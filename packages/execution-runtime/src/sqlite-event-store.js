import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export class SqliteAgentEventStore {
    db;
    lock = Promise.resolve();
    closed = false;
    constructor(db) {
        this.db = db;
    }
    static async open(path) { await mkdir(dirname(path), { recursive: true }); const db = new DatabaseSync(path); const store = new SqliteAgentEventStore(db); store.initialize(); await store.recoverPendingTasks(); return store; }
    async append(input) { return this.withLock(() => { this.ensureOpen(); const sequence = this.nextSequence(input.treeId, input.agentId); const event = { ...input, id: crypto.randomUUID(), sequence, timestamp: Date.now() }; this.transaction(() => this.insert(event)); return event; }); }
    async read(treeId, agentId) { this.ensureOpen(); const rows = agentId === undefined ? this.all("SELECT * FROM events WHERE tree_id=? ORDER BY timestamp, sequence", treeId) : this.all("SELECT * FROM events WHERE tree_id=? AND agent_id=? ORDER BY timestamp, sequence", treeId, agentId); return rows.map(row => this.toEvent(row)); }
    async snapshot(treeId, agentId) { this.ensureOpen(); return this.snapshotSync(treeId, agentId); }
    async replay(treeId, agentId) { return this.snapshot(treeId, agentId); }
    async setValue(treeId, agentId, key, value) { return this.withLock(() => { this.ensureOpen(); const current = this.snapshotSync(treeId, agentId); const next = { ...current, values: { ...current.values, [key]: value }, version: current.version + 1 }; const event = { id: `${treeId}:${agentId}:checkpoint:${next.version}`, treeId, agentId, sequence: this.nextSequence(treeId, agentId), type: "checkpoint", timestamp: Date.now(), payload: { key, value, version: next.version } }; this.transaction(() => { this.insert(event); this.db.prepare("INSERT INTO agent_state (tree_id, agent_id, values_json, version) VALUES (?, ?, ?, ?) ON CONFLICT(tree_id, agent_id) DO UPDATE SET values_json=excluded.values_json, version=excluded.version").run(treeId, agentId, JSON.stringify(next.values), next.version); }); return next; }); }
    async enqueueTask(input) { return this.withLock(() => { this.ensureOpen(); const id = input.id ?? crypto.randomUUID(); const now = Date.now(); this.transaction(() => this.db.prepare("INSERT INTO task_queue (id,idempotency_key,payload_json,status,attempts,recovery_count,worker_id,fencing_token,created_at,updated_at,lease_until,error) VALUES (?,?,?,'PENDING',0,0,NULL,0,?,?,NULL,NULL) ON CONFLICT(idempotency_key) DO NOTHING").run(id, input.idempotencyKey, JSON.stringify(input.payload), now, now)); const task = this.getTaskByIdempotency(input.idempotencyKey); if (!task)
        throw new Error("Task enqueue failed without a persisted task"); return task; }); }
    async claimPendingTask(workerId, leaseMs = 30000) { return this.withLock(() => { this.ensureOpen(); const task = this.get("SELECT * FROM task_queue WHERE status='PENDING' ORDER BY created_at,id LIMIT 1"); if (!task)
        return undefined; const now = Date.now(); const token = Number(task.fencing_token ?? 0) + 1; this.transaction(() => this.db.prepare("UPDATE task_queue SET status='RUNNING',worker_id=?,fencing_token=?,attempts=attempts+1,updated_at=?,lease_until=? WHERE id=? AND status='PENDING'").run(workerId, token, now, now + leaseMs, String(task.id))); return this.getTaskRow(String(task.id)); }); }
    async heartbeatTask(taskId, workerId, fencingToken, leaseMs = 30000) { return this.withLock(() => { this.ensureOpen(); const now = Date.now(); const result = this.db.prepare("UPDATE task_queue SET lease_until=?,updated_at=? WHERE id=? AND status='RUNNING' AND worker_id=? AND fencing_token=? AND lease_until>?").run(now + leaseMs, now, taskId, workerId, fencingToken, now); return Number(result.changes) === 1 ? this.getTaskRow(taskId) : undefined; }); }
    async reapExpiredLeases(now = Date.now()) { return this.withLock(() => { this.ensureOpen(); const result = this.db.prepare("UPDATE task_queue SET status='PENDING',worker_id=NULL,lease_until=NULL,recovery_count=recovery_count+1,updated_at=? WHERE status='RUNNING' AND lease_until IS NOT NULL AND lease_until<=?").run(now, now); return Number(result.changes); }); }
    async completeTask(taskId) { return this.transitionTask(taskId, "COMPLETED"); }
    async failTask(taskId, error) { return this.transitionTask(taskId, "FAILED", error); }
    async completeTaskFenced(taskId, workerId, fencingToken) { return this.transitionFenced(taskId, workerId, fencingToken, "COMPLETED"); }
    async failTaskFenced(taskId, workerId, fencingToken, error) { return this.transitionFenced(taskId, workerId, fencingToken, "FAILED", error); }
    async recoverPendingTasks() { return this.withLock(() => { this.ensureOpen(); const result = this.db.prepare("UPDATE task_queue SET status='PENDING',worker_id=NULL,lease_until=NULL,recovery_count=recovery_count+1,updated_at=? WHERE status='RUNNING'").run(Date.now()); return Number(result.changes); }); }
    async getTask(taskId) { this.ensureOpen(); return this.getTaskRow(taskId); }
    async close() { await this.withLock(() => { if (this.closed)
        return; this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); this.db.close(); this.closed = true; }); }
    initialize() { this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;"); const mode = this.get("PRAGMA journal_mode"); if (String(mode?.journal_mode).toLowerCase() !== "wal")
        throw new Error("KLYN durable execution requires SQLite WAL mode"); this.db.exec(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY,tree_id TEXT NOT NULL,agent_id TEXT NOT NULL,sequence INTEGER NOT NULL,type TEXT NOT NULL,timestamp INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(tree_id,agent_id,sequence));CREATE INDEX IF NOT EXISTS idx_events_tree ON events(tree_id,timestamp,sequence);CREATE TABLE IF NOT EXISTS agent_state (tree_id TEXT NOT NULL,agent_id TEXT NOT NULL,values_json TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(tree_id,agent_id));CREATE TABLE IF NOT EXISTS task_queue (id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','COMPLETED','FAILED')),attempts INTEGER NOT NULL DEFAULT 0,recovery_count INTEGER NOT NULL DEFAULT 0,worker_id TEXT,fencing_token INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lease_until INTEGER,error TEXT);CREATE INDEX IF NOT EXISTS idx_task_queue_claim ON task_queue(status,created_at,id);CREATE INDEX IF NOT EXISTS idx_task_queue_lease ON task_queue(status,lease_until);`); this.ensureFencingColumn(); }
    ensureFencingColumn() { const columns = this.all("PRAGMA table_info(task_queue)"); if (!columns.some(row => String(row.name) === "fencing_token"))
        this.db.exec("ALTER TABLE task_queue ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0"); }
    transaction(operation) { this.db.exec("BEGIN IMMEDIATE"); try {
        operation();
        this.db.exec("COMMIT");
    }
    catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
    } }
    nextSequence(treeId, agentId) { return Number(this.get("SELECT COALESCE(MAX(sequence),0) AS sequence FROM events WHERE tree_id=? AND agent_id=?", treeId, agentId)?.sequence ?? 0) + 1; }
    insert(event) { this.db.prepare("INSERT INTO events (id,tree_id,agent_id,sequence,type,timestamp,payload) VALUES (?,?,?,?,?,?,?)").run(event.id, event.treeId, event.agentId, event.sequence, event.type, event.timestamp, JSON.stringify(event.payload)); }
    snapshotSync(treeId, agentId) { const row = this.get("SELECT tree_id,agent_id,values_json,version FROM agent_state WHERE tree_id=? AND agent_id=?", treeId, agentId); return row ? { treeId: String(row.tree_id), agentId: String(row.agent_id), values: JSON.parse(String(row.values_json)), version: Number(row.version) } : { treeId, agentId, values: {}, version: 0 }; }
    get(sql, ...params) { return this.db.prepare(sql).get(...params); }
    all(sql, ...params) { return this.db.prepare(sql).all(...params); }
    getTaskRow(id) { return this.mapTask(this.get("SELECT * FROM task_queue WHERE id=?", id)); }
    getTaskByIdempotency(key) { return this.mapTask(this.get("SELECT * FROM task_queue WHERE idempotency_key=?", key)); }
    mapTask(row) { if (!row)
        return undefined; return { id: String(row.id), idempotencyKey: String(row.idempotency_key), payload: JSON.parse(String(row.payload_json)), status: row.status, attempts: Number(row.attempts), recoveryCount: Number(row.recovery_count), ...(row.worker_id == null ? {} : { workerId: String(row.worker_id) }), ...(Number(row.fencing_token ?? 0) > 0 ? { fencingToken: Number(row.fencing_token) } : {}), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ...(row.lease_until == null ? {} : { leaseUntil: Number(row.lease_until) }), ...(row.error == null ? {} : { error: String(row.error) }) }; }
    async transitionTask(taskId, status, error) { return this.withLock(() => { this.ensureOpen(); this.transaction(() => this.db.prepare("UPDATE task_queue SET status=?,error=?,updated_at=?,lease_until=NULL WHERE id=? AND status='RUNNING'").run(status, error ?? null, Date.now(), taskId)); return this.getTaskRow(taskId); }); }
    async transitionFenced(taskId, workerId, fencingToken, status, error) { return this.withLock(() => { this.ensureOpen(); const now = Date.now(); const result = this.db.prepare("UPDATE task_queue SET status=?,error=?,updated_at=?,lease_until=NULL WHERE id=? AND status='RUNNING' AND worker_id=? AND fencing_token=? AND lease_until>?").run(status, error ?? null, now, taskId, workerId, fencingToken, now); return Number(result.changes) === 1 ? this.getTaskRow(taskId) : undefined; }); }
    toEvent(row) { return { id: String(row.id), treeId: String(row.tree_id), agentId: String(row.agent_id), sequence: Number(row.sequence), type: row.type, timestamp: Number(row.timestamp), payload: JSON.parse(String(row.payload)) }; }
    ensureOpen() { if (this.closed)
        throw new Error("SQLite event store is closed"); }
    async withLock(operation) { const previous = this.lock; let release; this.lock = new Promise(resolve => { release = resolve; }); await previous; try {
        return await operation();
    }
    finally {
        release();
    } }
}
export class SqliteEventStoreFactory {
    kind = "sqlite";
    open(path) { return SqliteAgentEventStore.open(path); }
}
//# sourceMappingURL=sqlite-event-store.js.map