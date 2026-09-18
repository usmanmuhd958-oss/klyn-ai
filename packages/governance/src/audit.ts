import { sha256, canonicalize } from "./crypto.js";
import type { AuditEvent, AuditRecord, JsonValue } from "./types.js";
import { isJsonValue, ValidationError } from "./validation.js";
import { InMemoryAuditStorageAdapter, type AuditStorageAdapter } from "./audit-storage.js";

const GENESIS_HASH = "0".repeat(64);

function auditEventToJson(event: AuditEvent): JsonValue {
  const normalized: unknown = JSON.parse(JSON.stringify(event)) as unknown;
  if (!isJsonValue(normalized)) throw new ValidationError("audit event contains unsupported data");
  return normalized;
}

function hashRecord(sequence: number, previousHash: string, event: AuditEvent): string {
  return sha256(canonicalize({ sequence, previousHash, event: auditEventToJson(event) }));
}

export class AuditLedger {
  private readonly recordsStore: AuditRecord[];

  public constructor(private readonly storage: AuditStorageAdapter = new InMemoryAuditStorageAdapter()) {
    const loaded = storage.load();
    this.recordsStore = [...loaded];
    if (!this.verify()) throw new ValidationError("audit storage contains an invalid hash chain");
  }

  public append(event: AuditEvent): AuditRecord {
    const previousHash = this.recordsStore.at(-1)?.hash ?? GENESIS_HASH;
    const sequence = this.recordsStore.length + 1;
    const record: AuditRecord = Object.freeze({
      sequence,
      previousHash,
      event: deepFreeze(event),
      hash: hashRecord(sequence, previousHash, event),
    });

    this.storage.append(record);
    this.recordsStore.push(record);
    return record;
  }

  public headHash(): string {
    return this.recordsStore.at(-1)?.hash ?? GENESIS_HASH;
  }

  public length(): number {
    return this.recordsStore.length;
  }

  public records(): readonly AuditRecord[] {
    return Object.freeze([...this.recordsStore]);
  }

  public verify(): boolean {
    let previousHash = GENESIS_HASH;
    for (let index = 0; index < this.recordsStore.length; index += 1) {
      const record = this.recordsStore[index];
      if (record === undefined) return false;
      if (record.sequence !== index + 1 || record.previousHash !== previousHash) return false;
      if (record.hash !== hashRecord(record.sequence, record.previousHash, record.event)) return false;
      previousHash = record.hash;
    }
    return true;
  }

  public close(): void {
    this.storage.close?.();
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
  } else {
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return Object.freeze(value);
}
