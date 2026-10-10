import type { AuditRecord } from "./types.js";
export interface AuditStorageAdapter {
    load(): readonly AuditRecord[];
    append(record: AuditRecord): void;
    close?(): void;
}
export declare class InMemoryAuditStorageAdapter implements AuditStorageAdapter {
    private readonly recordsStore;
    constructor(records?: readonly AuditRecord[]);
    load(): readonly AuditRecord[];
    append(record: AuditRecord): void;
}
export interface FileAuditStorageOptions {
    readonly createDirectories?: boolean;
}
export declare class FileAuditStorageAdapter implements AuditStorageAdapter {
    readonly path: string;
    private readonly createDirectories;
    constructor(path: string, options?: FileAuditStorageOptions);
    load(): readonly AuditRecord[];
    append(record: AuditRecord): void;
}
export interface SqliteAuditStorageOptions {
    readonly busyTimeoutMs?: number;
}
export declare class SqliteAuditStorageAdapter implements AuditStorageAdapter {
    private readonly database;
    constructor(path: string, options?: SqliteAuditStorageOptions);
    load(): readonly AuditRecord[];
    append(record: AuditRecord): void;
    close(): void;
}
export type PersistentAuditStorageKind = "file" | "sqlite";
export declare function createDefaultPersistentAuditStorage(kind?: PersistentAuditStorageKind, path?: string): AuditStorageAdapter;
//# sourceMappingURL=audit-storage.d.ts.map