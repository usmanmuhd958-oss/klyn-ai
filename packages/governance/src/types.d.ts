export declare const RISK_LEVELS: readonly ["low", "medium", "high", "critical"];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export declare const RESOURCE_KINDS: readonly ["filesystem", "network", "database", "secret", "artifact", "other"];
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export declare const EVIDENCE_KINDS: readonly ["test-result", "static-analysis", "runtime-observation", "cryptographic-proof", "external-attestation"];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export declare const VERIFICATION_STATUSES: readonly ["verified", "rejected"];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export interface Principal {
    readonly principalId: string;
    readonly sessionId: string;
}
export interface ResourceReference {
    readonly kind: ResourceKind;
    readonly locator: string;
}
export interface ToolExecutionRequest {
    readonly requestId: string;
    readonly objectiveId: string;
    readonly principal: Principal;
    readonly toolName: string;
    readonly operation: string;
    readonly risk: RiskLevel;
    readonly resource?: ResourceReference;
    readonly networkOrigin?: string;
    readonly declaredPurpose: string;
    readonly requestedAtEpochMs: number;
}
export interface ScopeResourceSelector {
    readonly kind: ResourceKind;
    readonly match: 'exact' | 'prefix';
    readonly value: string;
}
export interface ToolExecutionScope {
    readonly scopeId: string;
    readonly principalId: string;
    readonly toolName: string;
    readonly operation: string;
    readonly maxRisk: RiskLevel;
    readonly resources: readonly ScopeResourceSelector[];
    readonly networkOrigins: readonly string[];
    readonly expiresAtEpochMs: number;
    readonly policyVersion: string;
}
export type AuthorizationReason = 'granted' | 'no-matching-scope' | 'scope-expired' | 'risk-exceeds-scope' | 'resource-not-allowed' | 'network-origin-not-allowed' | 'malformed-request' | 'malformed-scope';
export interface AuthorizationDecision {
    readonly allowed: boolean;
    readonly reason: AuthorizationReason;
    readonly requestId: string;
    readonly scopeId?: string;
    readonly evaluatedAtEpochMs: number;
}
export interface VerificationInvariant {
    readonly invariantId: string;
    readonly statement: string;
}
export interface VerificationObjective {
    readonly objectiveId: string;
    readonly requiredInvariants: readonly VerificationInvariant[];
    readonly policyVersion: string;
}
export interface EvidenceRecord {
    readonly evidenceId: string;
    readonly objectiveId: string;
    readonly kind: EvidenceKind;
    readonly statement: string;
    readonly source: string;
    readonly payloadDigest: string;
    readonly invariantIds: readonly string[];
    readonly verificationStatus: VerificationStatus;
    readonly verifierId: string;
    readonly collectedAtEpochMs: number;
}
export interface CompletionDecision {
    readonly objectiveId: string;
    readonly complete: boolean;
    readonly satisfiedInvariantIds: readonly string[];
    readonly missingInvariantIds: readonly string[];
    readonly acceptedEvidenceIds: readonly string[];
    readonly rejectedEvidenceIds: readonly string[];
    readonly decisionReason: 'all-invariants-verified' | 'missing-verified-evidence';
    readonly evaluatedAtEpochMs: number;
}
export interface ArtifactManifest {
    readonly artifactId: string;
    readonly artifactKind: string;
    readonly contentDigest: string;
    readonly producerPrincipalId: string;
    readonly objectiveId: string;
    readonly sourceCommitDigest: string;
    readonly createdAtEpochMs: number;
}
export interface ArtifactAttestation {
    readonly version: 1;
    readonly algorithm: 'Ed25519';
    readonly keyId: string;
    readonly artifact: ArtifactManifest;
    readonly evidenceDigest: string;
    readonly auditHeadHash: string;
    readonly completionProofDigest: string;
    readonly payloadDigest: string;
    readonly signatureBase64: string;
    readonly attestedAtEpochMs: number;
}
export type AuditEvent = {
    readonly kind: 'authorization';
    readonly requestId: string;
    readonly principalId: string;
    readonly toolName: string;
    readonly operation: string;
    readonly decision: 'allowed' | 'denied';
    readonly reason: AuthorizationReason;
    readonly scopeId?: string;
    readonly timestampEpochMs: number;
} | {
    readonly kind: 'evidence-recorded';
    readonly evidenceId: string;
    readonly objectiveId: string;
    readonly verificationStatus: VerificationStatus;
    readonly evidenceDigest: string;
    readonly timestampEpochMs: number;
} | {
    readonly kind: 'completion-gate';
    readonly objectiveId: string;
    readonly decision: 'complete' | 'blocked';
    readonly missingInvariantIds: readonly string[];
    readonly acceptedEvidenceIds: readonly string[];
    readonly timestampEpochMs: number;
} | {
    readonly kind: 'artifact-attested';
    readonly artifactId: string;
    readonly objectiveId: string;
    readonly attestationPayloadDigest: string;
    readonly timestampEpochMs: number;
};
export interface AuditRecord {
    readonly sequence: number;
    readonly previousHash: string;
    readonly event: AuditEvent;
    readonly hash: string;
}
export interface GovernanceSnapshot {
    readonly auditHeadHash: string;
    readonly auditLength: number;
    readonly evidenceCount: number;
}
//# sourceMappingURL=types.d.ts.map