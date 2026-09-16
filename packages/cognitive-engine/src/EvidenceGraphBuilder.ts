import { createHash } from "node:crypto";
import type { IntentSpec } from "./IntentSpec.js";

export type EvidenceCategory = "DIRECT" | "CONTEXTUAL" | "CONTRADICTING";
export type EvidenceNodeKind = "CLAIM" | "OBSERVATION";

export interface EvidenceObservation {
  readonly executionId: string;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly hash: string;
  readonly previousHash: string;
}

export interface EvidenceClaim {
  readonly claimId: string;
  readonly source: "ACCEPTANCE_CRITERION" | "REQUIRED_EVIDENCE";
  readonly sourceId: string;
  readonly description: string;
  readonly verification: "TEST" | "OBSERVATION" | "PROOF" | "MANUAL_REVIEW" | "EVIDENCE";
  readonly required: boolean;
}

export interface EvidenceNode {
  readonly id: string;
  readonly kind: EvidenceNodeKind;
  readonly claim?: EvidenceClaim;
  readonly observation?: EvidenceObservation;
}

export interface EvidenceEdge {
  readonly from: string;
  readonly to: string;
  readonly category: EvidenceCategory;
  readonly reason: string;
}

export interface EvidenceGraph {
  readonly intentId: string;
  readonly contentHash: string;
  readonly nodes: readonly EvidenceNode[];
  readonly edges: readonly EvidenceEdge[];
  readonly graphHash: string;
}

export class EvidenceGraphError extends Error {
  readonly code = "EVIDENCE_GRAPH_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "EvidenceGraphError";
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as Record<string, unknown>;
  return Object.keys(object).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize(object[key]);
    return result;
  }, {});
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function claimId(kind: EvidenceClaim["source"], sourceId: string): string {
  return `claim:${kind.toLowerCase()}:${sourceId}`;
}

function observationId(observation: EvidenceObservation): string {
  return `observation:${observation.sequence}:${observation.hash}`;
}

function isRuntimeAssertion(observation: EvidenceObservation): boolean {
  return observation.type === "runtime.assertion" || observation.type === "test.assertion";
}

function assertionOutcome(observation: EvidenceObservation): boolean | undefined {
  const value = observation.payload["passed"] ?? observation.payload["success"] ?? observation.payload["verified"];
  return typeof value === "boolean" ? value : undefined;
}

function observationMatchesClaim(claim: EvidenceClaim, observation: EvidenceObservation): EvidenceCategory | undefined {
  if (isRuntimeAssertion(observation)) {
    const target = observation.payload["criterionId"] ?? observation.payload["evidenceId"];
    if (target === claim.sourceId) {
      const outcome = assertionOutcome(observation);
      if (outcome === false) return "CONTRADICTING";
      if (outcome === true) return "DIRECT";
    }
  }

  if (claim.verification === "TEST" && observation.type === "process.exited") {
    const exitCode = observation.payload["exitCode"];
    const target = observation.payload["criterionId"];
    if (target === claim.sourceId && exitCode !== 0) return "CONTRADICTING";
    if (target === claim.sourceId && exitCode === 0) return "DIRECT";
  }

  if (claim.verification === "OBSERVATION" && (observation.type === "stdout" || observation.type === "stderr")) {
    const target = observation.payload["criterionId"];
    if (target === claim.sourceId && observation.type === "stderr") return "CONTRADICTING";
    if (target === claim.sourceId && observation.type === "stdout") return "DIRECT";
  }

  if (claim.source === "REQUIRED_EVIDENCE" && observation.payload["evidenceId"] === claim.sourceId) return "DIRECT";
  if (observation.type === "resource.snapshot" || observation.type === "process.started") return "CONTEXTUAL";
  return undefined;
}

export class EvidenceGraphBuilder {
  build(intent: IntentSpec, observations: readonly EvidenceObservation[]): EvidenceGraph {
    this.validateObservations(observations);

    const claims: EvidenceClaim[] = [
      ...intent.acceptanceCriteria.map((criterion): EvidenceClaim => ({
        claimId: claimId("ACCEPTANCE_CRITERION", criterion.id),
        source: "ACCEPTANCE_CRITERION",
        sourceId: criterion.id,
        description: criterion.description,
        verification: criterion.verification,
        required: criterion.required,
      })),
      ...intent.requiredEvidence.map((evidence): EvidenceClaim => ({
        claimId: claimId("REQUIRED_EVIDENCE", evidence.id),
        source: "REQUIRED_EVIDENCE",
        sourceId: evidence.id,
        description: evidence.description,
        verification: "EVIDENCE",
        required: evidence.required,
      })),
    ].sort((a, b) => a.claimId.localeCompare(b.claimId));

    const claimNodes = claims.map((claim): EvidenceNode => Object.freeze({ id: claim.claimId, kind: "CLAIM", claim: Object.freeze(claim) }));
    const observationNodes = [...observations]
      .sort((a, b) => a.sequence - b.sequence || a.hash.localeCompare(b.hash))
      .map((observation): EvidenceNode => Object.freeze({ id: observationId(observation), kind: "OBSERVATION", observation: Object.freeze(observation) }));
    const nodes = Object.freeze([...claimNodes, ...observationNodes]);

    const edges: EvidenceEdge[] = [];
    for (const claim of claims) {
      for (const observation of observations) {
        const category = observationMatchesClaim(claim, observation);
        if (category === undefined) continue;
        edges.push(Object.freeze({
          from: claim.claimId,
          to: observationId(observation),
          category,
          reason: `${category.toLowerCase()} evidence for ${claim.sourceId}`,
        }));
      }
    }
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.category.localeCompare(b.category) || a.to.localeCompare(b.to));
    this.assertAcyclic(nodes, edges);

    const graphContent = { intentId: intent.intentId, contentHash: intent.contentHash, nodes, edges };
    return Object.freeze({ ...graphContent, graphHash: hash(graphContent) });
  }

  private validateObservations(observations: readonly EvidenceObservation[]): void {
    const seen = new Set<string>();
    for (const observation of observations) {
      if (!Number.isInteger(observation.sequence) || observation.sequence < 0) throw new EvidenceGraphError("Observation sequence must be a non-negative integer");
      if (!/^[a-f0-9]{64}$/.test(observation.hash) || !/^[a-f0-9]{64}$/.test(observation.previousHash)) throw new EvidenceGraphError("Observation hashes must be SHA-256 hex digests");
      const id = observationId(observation);
      if (seen.has(id)) throw new EvidenceGraphError(`Duplicate observation: ${id}`);
      seen.add(id);
    }
  }

  private assertAcyclic(nodes: readonly EvidenceNode[], edges: readonly EvidenceEdge[]): void {
    const adjacency = new Map<string, readonly string[]>();
    for (const node of nodes) adjacency.set(node.id, []);
    for (const edge of edges) adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) throw new EvidenceGraphError("Evidence graph contains a cycle");
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      for (const next of adjacency.get(nodeId) ?? []) visit(next);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    for (const node of nodes) visit(node.id);
  }
}
