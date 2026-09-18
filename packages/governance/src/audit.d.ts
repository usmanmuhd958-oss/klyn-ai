import type { AuditEvent, AuditRecord } from './types.js';
export declare class AuditLedger {
    private readonly recordsStore;
    append(event: AuditEvent): AuditRecord;
    headHash(): string;
    length(): number;
    records(): readonly AuditRecord[];
    verify(): boolean;
}
//# sourceMappingURL=audit.d.ts.map