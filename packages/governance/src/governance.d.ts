import type { KeyObject } from "node:crypto";
import { AuditLedger } from "./audit.js";
import { ArtifactAttestor } from "./attestation.js";
import { CompletionGate, EvidenceLedger } from "./evidence.js";
import type { ArtifactAttestation, AuditEvent, AuthorizationDecision, CompletionDecision, EvidenceRecord, GovernanceSnapshot } from "./types.js";
import type { AuditStorageAdapter } from "./audit-storage.js";
export interface GovernanceEngineOptions {
    readonly auditStorage?: AuditStorageAdapter;
}
export declare class GovernanceEngine {
    readonly audit: AuditLedger;
    readonly evidence: EvidenceLedger;
    readonly completion: CompletionGate;
    readonly attestation: ArtifactAttestor;
    private readonly authorizer;
    constructor(options?: GovernanceEngineOptions);
    authorize(requestInput: unknown, scopes: readonly unknown[], nowEpochMs?: number): AuthorizationDecision;
    recordEvidence(input: unknown): EvidenceRecord;
    evaluateCompletion(objectiveInput: unknown, nowEpochMs?: number): CompletionDecision;
    attestArtifact(manifestInput: unknown, objectiveInput: unknown, keyId: string, privateKey: KeyObject, nowEpochMs?: number): ArtifactAttestation;
    appendAuditEvent(event: AuditEvent): void;
    snapshot(): GovernanceSnapshot;
    close(): void;
    private totalEvidenceCount;
}
//# sourceMappingURL=governance.d.ts.map