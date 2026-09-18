import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { AuditRecord } from "./types.js";

export interface AuditStorageAdapter {
  load(): readonly AuditRecord[];
  append(record: AuditRecord): void;
  close?(): void;
}

function assertHexHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(field + " must be a 64-character lowercase SHA-256 hex digest");
  }
}

function parseStoredRecord(input: unknown): AuditRecord {
  if (typeof input !== "object" || input === null) throw new Error("stored audit record must be an object");
  const value = input as Record<string, unknown>;
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) {
    throw new Error("stored audit sequence must be a positive safe integer");
  }
  assertHexHash(value.previousHash, "previousHash");
  assertHexHash(value.hash, "hash");
  if (typeof value.event !== "object" || value.event === null) {
    throw new Error("stored audit event must be an object");
  }
  return Object.freeze({
    sequence: Number(value.sequence),
    previousHash: String(value.previousHash),
    event: value.event as AuditRecord["event"],
    hash: String(value.hash),
  });
}

function freezeRecords(records: readonly AuditRecord[]): readonly AuditRecord[] {
  return Object.freeze(records.map((record) => Object.freeze(record)));
}

export class InMemoryAuditStorageAdapter implements AuditStorageAdapter {
  private readonly recordsStore: AuditRecord[];

  public constructor(records: readonly AuditRecord[] = []) {
    this.recordsStore = [...records];
  }

  public load(): readonly AuditRecord[] {
    return freezeRecords(this.recordsStore);
  }

  public append(record: AuditRecord): void {
    const previous = this.recordsStore.at(-1);
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    const expectedPreviousHash = previous?.hash ?? "0".repeat(64);

    if (record.sequence !== expectedSequence) {
      throw new Error("audit storage sequence conflict");
    }
    if (record.previousHash !== expectedPreviousHash) {
      throw new Error("audit storage previous-hash conflict");
    }

    this.recordsStore.push(record);
  }
}

export interface FileAuditStorageOptions {
  readonly createDirectories?: boolean;
}

export class FileAuditStorageAdapter implements AuditStorageAdapter {
  readonly path: string;
  private readonly createDirectories: boolean;

  public constructor(path: string, options: FileAuditStorageOptions = {}) {
    if (!path.trim()) throw new Error("audit file path is required");
    this.path = resolve(path);
    this.createDirectories = options.createDirectories ?? true;
    if (this.createDirectories) mkdirSync(dirname(this.path), { recursive: true });
  }

  public load(): readonly AuditRecord[] {
    if (!existsSync(this.path)) return Object.freeze([]);

    const content = readFileSync(this.path, "utf8");
    if (content.length === 0) return Object.freeze([]);

    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();

    const records: AuditRecord[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) throw new Error("audit file contains an empty line at " + (index + 1));
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error("audit file contains invalid JSON at line " + (index + 1), { cause: error });
      }
      records.push(parseStoredRecord(parsed));
    }
    return freezeRecords(records);
  }

  public append(record: AuditRecord): void {
    const records = this.load();
    const previous = records.at(-1);
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    const expectedPreviousHash = previous?.hash ?? "0".repeat(64);

    if (record.sequence !== expectedSequence) throw new Error("audit file sequence conflict");
    if (record.previousHash !== expectedPreviousHash) throw new Error("audit file previous-hash conflict");

    if (this.createDirectories) mkdirSync(dirname(this.path), { recursive: true });
    const descriptor = openSync(this.path, "a");
    try {
      appendFileSync(descriptor, JSON.stringify(record) + "\n", "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}

export interface SqliteAuditStorageOptions {
  readonly busyTimeoutMs?: number;
}

interface SqliteAuditRow {
  sequence: number | bigint;
  previous_hash: string;
  event_json: string;
  hash: string;
}

export class SqliteAuditStorageAdapter implements AuditStorageAdapter {
  private readonly database: DatabaseSyncType;

  public constructor(path: string, options: SqliteAuditStorageOptions = {}) {
    const require = createRequire(import.meta.url);
    let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
    try {
      DatabaseSync = (require("node:sqlite") as { DatabaseSync: typeof import("node:sqlite").DatabaseSync }).DatabaseSync;
    } catch (error) {
      throw new Error(
        "@klyn/governance SQLite storage requires a Node.js runtime with node:sqlite support (Node 22.5+)",
        { cause: error },
      );
    }
    if (!path.trim()) throw new Error("SQLite audit path is required");
    mkdirSync(dirname(resolve(path)), { recursive: true });

    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new RangeError("busyTimeoutMs must be a non-negative integer");
    }

    this.database = new DatabaseSync(resolve(path), {
      timeout: busyTimeoutMs,
      enableForeignKeyConstraints: true,
    });
    this.database.exec("PRAGMA journal_mode=WAL;");
    this.database.exec("PRAGMA synchronous=FULL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS audit_records (
        sequence INTEGER PRIMARY KEY,
        previous_hash TEXT NOT NULL CHECK(length(previous_hash) = 64),
        event_json TEXT NOT NULL,
        hash TEXT NOT NULL CHECK(length(hash) = 64)
      ) STRICT;

      CREATE TRIGGER IF NOT EXISTS audit_records_no_update
      BEFORE UPDATE ON audit_records
      BEGIN
        SELECT RAISE(ABORT, 'audit records are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_records_no_delete
      BEFORE DELETE ON audit_records
      BEGIN
        SELECT RAISE(ABORT, 'audit records are append-only');
      END;
    `);
  }

  public load(): readonly AuditRecord[] {
    const rows = this.database
      .prepare("SELECT sequence, previous_hash, event_json, hash FROM audit_records ORDER BY sequence ASC")
      .all() as unknown as SqliteAuditRow[];

    return freezeRecords(rows.map((row) => parseStoredRecord({
      sequence: typeof row.sequence === "bigint" ? Number(row.sequence) : row.sequence,
      previousHash: row.previous_hash,
      event: JSON.parse(row.event_json) as unknown,
      hash: row.hash,
    })));
  }

  public append(record: AuditRecord): void {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const last = this.database
        .prepare("SELECT sequence, hash FROM audit_records ORDER BY sequence DESC LIMIT 1")
        .get() as { sequence?: number | bigint; hash?: string } | undefined;

      const currentSequence = last?.sequence === undefined ? 0 : Number(last.sequence);
      const currentHash = last?.hash ?? "0".repeat(64);

      if (record.sequence !== currentSequence + 1) throw new Error("SQLite audit sequence conflict");
      if (record.previousHash !== currentHash) throw new Error("SQLite audit previous-hash conflict");

      this.database
        .prepare(
          "INSERT INTO audit_records (sequence, previous_hash, event_json, hash) VALUES (?, ?, ?, ?)",
        )
        .run(
          record.sequence,
          record.previousHash,
          JSON.stringify(record.event),
          record.hash,
        );

      this.database.exec("COMMIT;");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch {
        // Preserve the original storage failure.
      }
      throw error;
    }
  }

  public close(): void {
    if (this.database.isOpen) this.database.close();
  }
}

export type PersistentAuditStorageKind = "file" | "sqlite";

export function createDefaultPersistentAuditStorage(
  kind: PersistentAuditStorageKind = "file",
  path = kind === "sqlite"
    ? (process.env.KLYN_AUDIT_SQLITE_PATH ?? "./data/klyn-audit.db")
    : (process.env.KLYN_AUDIT_FILE_PATH ?? "./data/klyn-audit.jsonl"),
): AuditStorageAdapter {
  return kind === "sqlite"
    ? new SqliteAuditStorageAdapter(path)
    : new FileAuditStorageAdapter(path);
}
