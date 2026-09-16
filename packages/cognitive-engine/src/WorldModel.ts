import type { Dependency, IntentSpec, ResourceBudget } from "./IntentSpec.js";

export type EpistemicStatus = "ASSUMED" | "OBSERVED" | "DERIVED" | "UNKNOWN";
export type WorldSlotKind = "OBJECTIVE" | "CONSTRAINT" | "ASSUMPTION" | "DEPENDENCY" | "RESOURCE" | "ACCEPTANCE" | "EVIDENCE";

export interface WorldSlot {
  readonly id: string;
  readonly kind: WorldSlotKind;
  readonly status: EpistemicStatus;
  readonly value: string;
  readonly source: string;
}

export interface ResourceState {
  readonly budget: ResourceBudget;
  readonly allocatedCpuMillis: number;
  readonly allocatedMemoryBytes: number;
  readonly allocatedWallClockMillis: number;
  readonly allocatedConcurrentTasks: number;
  readonly allocatedNetworkRequests: number;
  readonly allocatedArtifactBytes: number;
}

export interface WorldRelation {
  readonly from: string;
  readonly to: string;
  readonly relation: "DEPENDS_ON" | "SUPPORTS" | "CONSTRAINS" | "REQUIRES_EVIDENCE";
}

export interface EpistemicWorldModel {
  readonly intentId: string;
  readonly contentHash: string;
  readonly state: "FROZEN" | "EXECUTABLE";
  readonly slots: readonly WorldSlot[];
  readonly relations: readonly WorldRelation[];
  readonly resources: ResourceState;
}

export class WorldModelValidationError extends Error {
  readonly code = "WORLD_MODEL_VALIDATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "WorldModelValidationError";
  }
}

export class WorldModelBuilder {
  build(intent: IntentSpec): EpistemicWorldModel {
    if (intent.state !== "FROZEN" && intent.state !== "EXECUTABLE") {
      throw new WorldModelValidationError(`Intent ${intent.intentId} must be FROZEN or EXECUTABLE; received ${intent.state}`);
    }
    if (!/^[a-f0-9]{64}$/.test(intent.contentHash)) {
      throw new WorldModelValidationError("Intent contentHash must be a SHA-256 digest");
    }

    const slots: WorldSlot[] = [
      { id: "objective", kind: "OBJECTIVE", status: "OBSERVED", value: intent.objective.statement, source: intent.intentId },
      { id: "outcome", kind: "OBJECTIVE", status: "DERIVED", value: intent.objective.outcome, source: intent.intentId },
      ...intent.constraints.map((constraint) => ({
        id: `constraint:${constraint.id}`,
        kind: "CONSTRAINT" as const,
        status: "OBSERVED" as const,
        value: `${constraint.kind}:${constraint.statement}`,
        source: intent.intentId,
      })),
      ...intent.assumptions.map((assumption) => ({
        id: `assumption:${assumption.id}`,
        kind: "ASSUMPTION" as const,
        status: "ASSUMED" as const,
        value: assumption.statement,
        source: intent.intentId,
      })),
      ...intent.dependencies.map((dependency) => dependencySlot(dependency, intent.intentId)),
      ...intent.acceptanceCriteria.map((criterion) => ({
        id: `acceptance:${criterion.id}`,
        kind: "ACCEPTANCE" as const,
        status: "OBSERVED" as const,
        value: `${criterion.verification}:${criterion.description}`,
        source: intent.intentId,
      })),
      ...intent.requiredEvidence.map((evidence) => ({
        id: `evidence:${evidence.id}`,
        kind: "EVIDENCE" as const,
        status: evidence.required ? ("UNKNOWN" as const) : ("ASSUMED" as const),
        value: `${evidence.kind}:${evidence.description}`,
        source: intent.intentId,
      })),
      { id: "resource-budget", kind: "RESOURCE", status: "OBSERVED", value: JSON.stringify(intent.resourceBudget), source: intent.intentId },
    ];

    const relations: WorldRelation[] = [
      { from: "objective", to: "outcome", relation: "SUPPORTS" },
      ...intent.constraints.map((constraint) => ({ from: `constraint:${constraint.id}`, to: "objective", relation: "CONSTRAINS" as const })),
      ...intent.dependencies.map((dependency) => ({ from: "objective", to: `dependency:${dependency.id}`, relation: "DEPENDS_ON" as const })),
      ...intent.requiredEvidence.map((evidence) => ({ from: "objective", to: `evidence:${evidence.id}`, relation: "REQUIRES_EVIDENCE" as const })),
    ];

    const resources: ResourceState = {
      budget: intent.resourceBudget,
      allocatedCpuMillis: 0,
      allocatedMemoryBytes: 0,
      allocatedWallClockMillis: 0,
      allocatedConcurrentTasks: 0,
      allocatedNetworkRequests: 0,
      allocatedArtifactBytes: 0,
    };

    return Object.freeze({
      intentId: intent.intentId,
      contentHash: intent.contentHash,
      state: intent.state,
      slots: Object.freeze(slots.sort((a, b) => a.id.localeCompare(b.id))),
      relations: Object.freeze(relations.sort((a, b) => `${a.from}:${a.relation}:${a.to}`.localeCompare(`${b.from}:${b.relation}:${b.to}`))),
      resources: Object.freeze(resources),
    });
  }
}

function dependencySlot(dependency: Dependency, intentId: string): WorldSlot {
  return {
    id: `dependency:${dependency.id}`,
    kind: "DEPENDENCY",
    status: dependency.required ? "OBSERVED" : "ASSUMED",
    value: `${dependency.kind}:${dependency.name}${dependency.version ? `@${dependency.version}` : ""}`,
    source: intentId,
  };
}