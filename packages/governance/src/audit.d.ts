import type { AuditEvent, AuditRecord } from "./types.js";
import { type AuditStorageAdapter } from "./audit-storage.js";
export declare class AuditLedger {
    private readonly storage;
    private readonly recordsStore;
    constructor(storage?: AuditStorageAdapter);
    append(event: AuditEvent): AuditRecord;
    headHash(): string;
    length(): number;
    records(): readonly AuditRecord[];
    verify(): boolean;
    close(): void;
}
//# sourceMappingURL=audit.d.ts.map