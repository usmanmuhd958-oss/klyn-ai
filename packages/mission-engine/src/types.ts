export const MISSION_SCHEMA_VERSION = '1.0.0' as const;

export const MISSION_STATES = [
  'ACTION_EXECUTED',
  'ARTIFACT_PRODUCED',
  'TEST_PASSED',
  'REQUIREMENT_VERIFIED',
  'DEPLOYMENT_CONFIRMED',
  'FAILED',
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export const EVIDENCE_KINDS = [
  'action-receipt',
  'artifact-manifest',
  'test-result',
  'requirement-proof',
  'deployment-attestation',
] as const;
export type MissionEvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface MissionNode {
  readonly nodeId: string;
  readonly state: MissionState;
  readonly invariantIds: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface MissionInvariant {
  readonly invariantId: string;
  readonly statement: string;
}

export interface MissionGraph {
  readonly schemaVersion: typeof MISSION_SCHEMA_VERSION;
  readonly missionId: string;
  readonly objectiveId: string;
  readonly nodes: readonly MissionNode[];
  readonly invariants: readonly MissionInvariant[];
  readonly graphDigest: string;
}

export interface MissionEvidence {
  readonly evidenceId: string;
  readonly missionId: string;
  readonly objectiveId: string;
  readonly nodeId: string;
  readonly kind: MissionEvidenceKind;
  readonly statement: string;
  readonly payloadDigest: string;
  readonly artifactDigest?: string;
  readonly invariantIds: readonly string[];
  readonly predecessorEvidenceIds: readonly string[];
  readonly issuedAtEpochMs: number;
  readonly verifierId: string;
  readonly signatureBase64?: string;
}

export interface EvidenceVerifier {
  readonly verifierId: string;
  verify(evidence: MissionEvidence): boolean;
}

export interface MissionSnapshot {
  readonly missionId: string;
  readonly currentState: MissionState | 'NOT_STARTED';
  readonly completedNodeIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly satisfiedInvariantIds: readonly string[];
  readonly blocked: boolean;
}

export interface TransitionResult {
  readonly accepted: boolean;
  readonly from: MissionState | 'NOT_STARTED';
  readonly to: MissionState;
  readonly nodeId: string;
  readonly evidenceId: string;
  readonly reason: string;
  readonly snapshot: MissionSnapshot;
}

export interface MissionEngineOptions {
  readonly evidenceVerifier: EvidenceVerifier;
  readonly nowEpochMs?: () => number;
}
