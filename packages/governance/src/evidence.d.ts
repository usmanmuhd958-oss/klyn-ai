import { AuditLedger } from './audit.js';
import type { CompletionDecision, EvidenceRecord } from './types.js';
export declare class EvidenceLedger {
    private readonly evidence;
    private readonly audit;
    constructor(audit: AuditLedger);
    record(input: unknown): EvidenceRecord;
    get(evidenceId: string): EvidenceRecord | undefined;
    forObjective(objectiveId: string): readonly EvidenceRecord[];
    digestForObjective(objectiveId: string): string;
    recordDigest(record: EvidenceRecord): string;
}
export declare class CompletionGate {
    private readonly audit;
    private readonly evidence;
    constructor(audit: AuditLedger, evidence: EvidenceLedger);
    evaluate(input: unknown, nowEpochMs?: number): CompletionDecision;
}
//# sourceMappingURL=evidence.d.ts.map