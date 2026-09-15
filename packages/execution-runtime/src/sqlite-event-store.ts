import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentEvent, AgentEventStore, AgentState } from "./agent-state.js";

type Row = Record<string, unknown>;
export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface DurableTask<T = unknown> {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly payload: T;
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly recoveryCount: number;
  readonly workerId?: string;
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

export class SqliteAgentEventStore implements AgentEventStore {
  private lock: Promise<void> = Promise.resolve();
  private closed = false;
  private constructor(private readonly db: DatabaseSync) {}

  static async open(path: string): Promise<SqliteAgentEventStore> {
    await mkdir(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    const store = new SqliteAgentEventStore(db);
    store.initialize();
    await store.recoverPendingTasks();
    return store;
  }

  async append<T>(input: Omit<AgentEvent<T>, "id" | "sequence" | "timestamp">): Promise<AgentEvent<T>> {
    return this.withLock(() => {
      this.ensureOpen();
      const sequence = this.nextSequence(input.treeId, input.agentId);
      const event: AgentEvent<T> = { ...input, id: crypto.randomUUID(), sequence, timestamp: Date.now() };
      this.transaction(() => this.insert(event));
      return event;
    });
  }

  async read(treeId: string, agentId?: string): Promise<readonly AgentEvent[]> {
    this.ensureOpen();
    const rows = agentId === undefined
      ? this.all("SELECT * FROM events WHERE tree_id=? ORDER BY timestamp, sequence", treeId)
      : this.all("SELECT * FROM events WHERE tree_id=? AND agent_id=? ORDER BY timestamp, sequence", treeId, agentId);
    return rows.map((row) => this.toEvent(row));
  }

  async snapshot(treeId: string, agentId: string): Promise<AgentState> { this.ensureOpen(); return this.snapshotSync(treeId, agentId); }
  async replay(treeId: string, agentId: string): Promise<AgentState> { return this.snapshot(treeId, agentId); }

  async setValue(treeId: string, agentId: string, key: string, value: unknown): Promise<AgentState> {
    return this.withLock(() => {
      this.ensureOpen();
      const current = this.snapshotSync(treeId, agentId);
      const next: AgentState = { ...current, values: { ...current.values, [key]: value }, version: current.version + 1 };
      const event: AgentEvent = { id: `${treeId}:${agentId}:checkpoint:${next.version}`, treeId, agentId, sequence: this.nextSequence(treeId, agentId), type: "checkpoint", timestamp: Date.now(), payload: { key, value, version: next.version } };
      this.transaction(() => {
        this.insert(event);
        this.db.prepare("INSERT INTO agent_state (tree_id, agent_id, values_json, version) VALUES (?, ?, ?, ?) ON CONFLICT(tree_id, agent_id) DO UPDATE SET values_json=excluded.values_json, version=excluded.version").run(treeId, agentId, JSON.stringify(next.values), next.version);
      });
      return next;
    });
  }

  async enqueueTask<T>(input: EnqueueTaskInput<T>): Promise<DurableTask<T>> {
    return this.withLock(() => {
      this.ensureOpen();
      const id = input.id ?? crypto.randomUUID();
      const now = Date.now();
      this.transaction(() => this.db.prepare("INSERT INTO task_queue (id, idempotency_key, payload_json, status, attempts, recovery_count, worker_id, created_at, updated_at, lease_until, error) VALUES (?, ?, ?, 'PENDING', 0, 0, NULL, ?, ?, NULL, NULL) ON CONFLICT(idempotency_key) DO NOTHING").run(id, input.idempotencyKey, JSON.stringify(input.payload), now, now));
      const task = this.getTaskByIdempotency<T>(input.idempotencyKey);
      if (!task) throw new Error("Task enqueue failed without a persisted task");
      return task;
    });
  }

  async claimPendingTask<T>(workerId: string, leaseMs = 30_000): Promise<DurableTask<T> | undefined> {
    return this.withLock(() => {
      this.ensureOpen();
      const task = this.get("SELECT * FROM task_queue WHERE status='PENDING' ORDER BY created_at, id LIMIT 1");
      if (!task) return undefined;
      const now = Date.now();
      this.transaction(() => this.db.prepare("UPDATE task_queue SET status='RUNNING', worker_id=?, attempts=attempts+1, updated_at=?, lease_until=? WHERE id=? AND status='PENDING'").run(workerId, now, now + leaseMs, String(task.id)));
      return this.getTaskRow<T>(String(task.id));
    });
  }

  async completeTask(taskId: string): Promise<DurableTask | undefined> { return this.transitionTask(taskId, "COMPLETED"); }
  async failTask(taskId: string, error: string): Promise<DurableTask | undefined> { return this.transitionTask(taskId, "FAILED", error); }

  /** Restores RUNNING tasks left by an interrupted process to PENDING. */
  async recoverPendingTasks(): Promise<number> {
    return this.withLock(() => {
      this.ensureOpen();
      const result = this.db.prepare("UPDATE task_queue SET status='PENDING', worker_id=NULL, lease_until=NULL, recovery_count=recovery_count+1, updated_at=? WHERE status='RUNNING'").run(Date.now());
      return Number(result.changes);
    });
  }

  async getTask<T = unknown>(taskId: string): Promise<DurableTask<T> | undefined> { this.ensureOpen(); return this.getTaskRow<T>(taskId); }

  async close(): Promise<void> {
    await this.withLock(() => {
      if (this.closed) return;
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.db.close();
      this.closed = true;
    });
  }

  private initialize(): void {
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    const mode = this.get("PRAGMA journal_mode");
    if (String(mode?.journal_mode).toLowerCase() !== "wal") throw new Error("KLYN durable execution requires SQLite WAL mode");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, tree_id TEXT NOT NULL, agent_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, timestamp INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(tree_id, agent_id, sequence));
      CREATE INDEX IF NOT EXISTS idx_events_tree ON events(tree_id, timestamp, sequence);
      CREATE TABLE IF NOT EXISTS agent_state (tree_id TEXT NOT NULL, agent_id TEXT NOT NULL, values_json TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(tree_id, agent_id));
      CREATE TABLE IF NOT EXISTS task_queue (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','COMPLETED','FAILED')), attempts INTEGER NOT NULL DEFAULT 0, recovery_count INTEGER NOT NULL DEFAULT 0, worker_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, lease_until INTEGER, error TEXT);
      CREATE INDEX IF NOT EXISTS idx_task_queue_claim ON task_queue(status, created_at, id);
    `);
  }

  private transaction(operation: () => void): void { this.db.exec("BEGIN IMMEDIATE"); try { operation(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  private nextSequence(treeId: string, agentId: string): number { return Number(this.get("SELECT COALESCE(MAX(sequence),0) AS sequence FROM events WHERE tree_id=? AND agent_id=?", treeId, agentId)?.sequence ?? 0) + 1; }
  private insert(event: AgentEvent): void { this.db.prepare("INSERT INTO events (id,tree_id,agent_id,sequence,type,timestamp,payload) VALUES (?,?,?,?,?,?,?)").run(event.id,event.treeId,event.agentId,event.sequence,event.type,event.timestamp,JSON.stringify(event.payload)); }
  private snapshotSync(treeId: string, agentId: string): AgentState { const row=this.get("SELECT tree_id,agent_id,values_json,version FROM agent_state WHERE tree_id=? AND agent_id=?",treeId,agentId); return row ? {treeId:String(row.tree_id),agentId:String(row.agent_id),values:JSON.parse(String(row.values_json)),version:Number(row.version)} : {treeId,agentId,values:{},version:0}; }
  private get(sql: string, ...params: SQLInputValue[]): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  private all(sql: string, ...params: SQLInputValue[]): Row[] { return this.db.prepare(sql).all(...params) as Row[]; }
  private getTaskRow<T>(id: string): DurableTask<T> | undefined { return this.mapTask<T>(this.get("SELECT * FROM task_queue WHERE id=?", id)); }
  private getTaskByIdempotency<T>(key: string): DurableTask<T> | undefined { return this.mapTask<T>(this.get("SELECT * FROM task_queue WHERE idempotency_key=?", key)); }
  private mapTask<T>(row: Row | undefined): DurableTask<T> | undefined { if (!row) return undefined; return { id:String(row.id), idempotencyKey:String(row.idempotency_key), payload:JSON.parse(String(row.payload_json)) as T, status:row.status as TaskStatus, attempts:Number(row.attempts), recoveryCount:Number(row.recovery_count), ...(row.worker_id == null ? {} : {workerId:String(row.worker_id)}), createdAt:Number(row.created_at), updatedAt:Number(row.updated_at), ...(row.lease_until == null ? {} : {leaseUntil:Number(row.lease_until)}), ...(row.error == null ? {} : {error:String(row.error)}) }; }
  private async transitionTask(taskId: string, status: "COMPLETED" | "FAILED", error?: string): Promise<DurableTask | undefined> { return this.withLock(() => { this.ensureOpen(); this.transaction(() => this.db.prepare("UPDATE task_queue SET status=?, error=?, updated_at=?, lease_until=NULL WHERE id=? AND status='RUNNING'").run(status, error ?? null, Date.now(), taskId)); return this.getTaskRow(taskId); }); }
  private toEvent(row: Row): AgentEvent { return {id:String(row.id),treeId:String(row.tree_id),agentId:String(row.agent_id),sequence:Number(row.sequence),type:row.type as AgentEvent["type"],timestamp:Number(row.timestamp),payload:JSON.parse(String(row.payload))}; }
  private ensureOpen(): void { if (this.closed) throw new Error("SQLite event store is closed"); }
  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> { const previous=this.lock; let release!:()=>void; this.lock=new Promise<void>((resolve)=>{release=resolve;}); await previous; try{return await operation();} finally{release();} }
}

export class SqliteEventStoreFactory { readonly kind="sqlite" as const; open(path:string):Promise<AgentEventStore>{return SqliteAgentEventStore.open(path);} }
