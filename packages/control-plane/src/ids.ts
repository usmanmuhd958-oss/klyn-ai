import { brand, type AgentId, type ArtifactId, type CheckpointId, type CredentialId, type EventId, type ExecutionId, type MissionId, type PolicyId, type SandboxId, type TenantId, type TransitionId, type WorkerId, type EnvelopeId } from "./types.js";

function uuid(): string {
  return crypto.randomUUID();
}

export const newMissionId = (): MissionId => brand<string, "MissionId">(uuid());
export const newExecutionId = (): ExecutionId => brand<string, "ExecutionId">(uuid());
export const newAgentId = (): AgentId => brand<string, "AgentId">(uuid());
export const newArtifactId = (): ArtifactId => brand<string, "ArtifactId">(uuid());
export const newCheckpointId = (): CheckpointId => brand<string, "CheckpointId">(uuid());
export const newCredentialId = (): CredentialId => brand<string, "CredentialId">(uuid());
export const newEventId = (): EventId => brand<string, "EventId">(uuid());
export const newPolicyId = (): PolicyId => brand<string, "PolicyId">(uuid());
export const newSandboxId = (): SandboxId => brand<string, "SandboxId">(uuid());
export const newTenantId = (): TenantId => brand<string, "TenantId">(uuid());
export const newTransitionId = (): TransitionId => brand<string, "TransitionId">(uuid());
export const newWorkerId = (): WorkerId => brand<string, "WorkerId">(uuid());
export const newEnvelopeId = (): EnvelopeId => brand<string, "EnvelopeId">(uuid());
