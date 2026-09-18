import type { KeyObject } from 'node:crypto';
import { AuditLedger } from './audit.js';
import { ArtifactAttestor } from './attestation.js';
import { CompletionGate, EvidenceLedger } from './evidence.js';
import type { ArtifactAttestation, AuthorizationDecision, CompletionDecision, EvidenceRecord, GovernanceSnapshot } from './types.js';
export declare class GovernanceEngine {
    readonly audit: AuditLedger;
    readonly evidence: EvidenceLedger;
    readonly completion: CompletionGate;
    readonly attestation: ArtifactAttestor;
    private readonly authorizer;
    constructor();
    authorize(requestInput: unknown, scopes: readonly unknown[], nowEpochMs?: number): AuthorizationDecision;
    recordEvidence(input: unknown): EvidenceRecord;
    evaluateCompletion(objectiveInput: unknown, nowEpochMs?: number): CompletionDecision;
    attestArtifact(manifestInput: unknown, objectiveInput: unknown, keyId: string, privateKey: KeyObject, nowEpochMs?: number): ArtifactAttestation;
    snapshot(): GovernanceSnapshot;
    private totalEvidenceCount;
}
//# sourceMappingURL=governance.d.ts.map