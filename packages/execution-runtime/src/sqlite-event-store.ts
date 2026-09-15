import { createRequire } from "node:module";
import { readFile, rename, writeFile } from "node:fs/promises";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import type { AgentEvent, AgentEventStore, AgentState } from "./agent-state.js";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
type SqlRow = Record<string, unknown>;

/** Durable append-only SQLite store with serialized atomic mutations and replay. */
export class SqliteAgentEventStore implements AgentEventStore {
  private lock: Promise<void> = Promise.resolve();
  private constructor(private readonly db: Database, private readonly path: string) {}

  static async open(path: string): Promise<SqliteAgentEventStore> {
    const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmPath });
    let bytes: Uint8Array | undefined;
    try { bytes = new Uint8Array(await readFile(path)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const store = new SqliteAgentEventStore(bytes ? new SQL.Database(bytes) : new SQL.Database(), path);
    store.initialize();
    return store;
  }

  async append<T>(input: Omit<AgentEvent<T>, "id" | "sequence" | "timestamp">): Promise<AgentEvent<T>> {
    return this.withLock(async () => {
      const sequence = this.nextSequence(input.treeId, input.agentId);
      const event: AgentEvent<T> = { ...input, id: crypto.randomUUID(), sequence, timestamp: Date.now() };
      this.db.run("BEGIN IMMEDIATE");
      try {
        this.insert(event);
        this.db.run("COMMIT");
        await this.persist();
        return event;
      } catch (error) {
        this.db.run("ROLLBACK");
        throw error;
      }
    });
  }

  async read(treeId: string, agentId?: string): Promise<readonly AgentEvent[]> {
    const params: SqlValue[] = agentId === undefined ? [treeId] : [treeId, agentId];
    const sql = agentId === undefined
      ? "SELECT * FROM events WHERE tree_id=? ORDER BY timestamp, sequence"
      : "SELECT * FROM events WHERE tree_id=? AND agent_id=? ORDER BY timestamp, sequence";
    return this.rows(sql, params).map((row) => this.toEvent(row));
  }

  async snapshot(treeId: string, agentId: string): Promise<AgentState> {
    const row = this.rows("SELECT tree_id, agent_id, values_json, version FROM agent_state WHERE tree_id=? AND agent_id=?", [treeId, agentId])[0];
    if (!row) return { treeId, agentId, values: {}, version: 0 };
    return { treeId: String(row.tree_id), agentId: String(row.agent_id), values: JSON.parse(String(row.values_json)), version: Number(row.version) };
  }

  async replay(treeId: string, agentId: string): Promise<AgentState> {
    return this.snapshot(treeId, agentId);
  }

  async setValue(treeId: string, agentId: string, key: string, value: unknown): Promise<AgentState> {
    return this.withLock(async () => {
      const current = await this.snapshot(treeId, agentId);
      const next: AgentState = { ...current, values: { ...current.values, [key]: value }, version: current.version + 1 };
      const event: AgentEvent = {
        id: `${treeId}:${agentId}:checkpoint:${next.version}`,
        treeId,
        agentId,
        sequence: this.nextSequence(treeId, agentId),
        type: "checkpoint",
        timestamp: Date.now(),
        payload: { key, value, version: next.version },
      };
      this.db.run("BEGIN IMMEDIATE");
      try {
        this.insert(event);
        this.db.run("INSERT INTO agent_state (tree_id, agent_id, values_json, version) VALUES (?, ?, ?, ?) ON CONFLICT(tree_id, agent_id) DO UPDATE SET values_json=excluded.values_json, version=excluded.version", [treeId, agentId, JSON.stringify(next.values), next.version]);
        this.db.run("COMMIT");
        await this.persist();
        return next;
      } catch (error) { this.db.run("ROLLBACK"); throw error; }
    });
  }

  async close(): Promise<void> { await this.withLock(async () => { await this.persist(); this.db.close(); }); }

  private initialize(): void {
    this.db.run("PRAGMA synchronous = FULL");
    this.db.run("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, tree_id TEXT NOT NULL, agent_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, timestamp INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(tree_id, agent_id, sequence))");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_tree ON events(tree_id, timestamp, sequence)");
    this.db.run("CREATE TABLE IF NOT EXISTS agent_state (tree_id TEXT NOT NULL, agent_id TEXT NOT NULL, values_json TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(tree_id, agent_id))");
  }
  private nextSequence(treeId: string, agentId: string): number { return Number(this.rows("SELECT COALESCE(MAX(sequence),0) AS sequence FROM events WHERE tree_id=? AND agent_id=?", [treeId, agentId])[0]?.sequence ?? 0) + 1; }
  private insert(event: AgentEvent): void { this.db.run("INSERT INTO events (id,tree_id,agent_id,sequence,type,timestamp,payload) VALUES (?,?,?,?,?,?,?)", [event.id,event.treeId,event.agentId,event.sequence,event.type,event.timestamp,JSON.stringify(event.payload)]); }
  private rows(sql: string, params: SqlValue[] = []): SqlRow[] { const statement = this.db.prepare(sql); try { statement.bind(params); const out: SqlRow[]=[]; while(statement.step()) out.push(statement.getAsObject() as SqlRow); return out; } finally { statement.free(); } }
  private toEvent(row: SqlRow): AgentEvent { return { id:String(row.id), treeId:String(row.tree_id), agentId:String(row.agent_id), sequence:Number(row.sequence), type:row.type as AgentEvent["type"], timestamp:Number(row.timestamp), payload:JSON.parse(String(row.payload)) }; }
  private async persist(): Promise<void> { const temp=`${this.path}.tmp-${process.pid}`; await writeFile(temp, Buffer.from(this.db.export())); await rename(temp,this.path); }
  private async withLock<T>(operation:()=>Promise<T>): Promise<T> { const previous=this.lock; let release!:()=>void; this.lock=new Promise((resolve)=>{release=resolve;}); await previous; try{return await operation();} finally{release();} }
}

export class SqliteEventStoreFactory { readonly kind="sqlite" as const; open(path:string):Promise<AgentEventStore>{return SqliteAgentEventStore.open(path);} }