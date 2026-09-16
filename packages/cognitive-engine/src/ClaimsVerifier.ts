import { createHash } from "node:crypto";
import type { IntentSpec } from "./IntentSpec.js";
import type { EvidenceClaim, EvidenceGraph } from "./EvidenceGraphBuilder.js";

export type ClaimsVerificationState = "UNKNOWN" | "EVIDENCE-SUPPORTED" | "VERIFIED" | "REJECTED";
export type ClaimVerificationState = ClaimsVerificationState;

export interface ClaimVerificationResult {
  readonly claimId: string;
  readonly state: ClaimVerificationState;
  readonly directEvidence: readonly string[];
  readonly contextualEvidence: readonly string[];
  readonly contradictingEvidence: readonly string[];
  readonly reason: string;
}

export interface ClaimsVerificationResult {
  readonly intentId: string;
  readonly graphHash: string;
  readonly state: ClaimsVerificationState;
  readonly claims: readonly ClaimVerificationResult[];
  readonly verifiedClaimIds: readonly string[];
  readonly unresolvedClaimIds: readonly string[];
  readonly rejectedClaimIds: readonly string[];
  readonly verificationHash: string;
}

export class ClaimsVerificationError extends Error {
  readonly code = "CLAIMS_VERIFICATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ClaimsVerificationError";
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

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

interface ClaimEvidenceBuckets {
  direct: string[];
  contextual: string[];
  contradicting: string[];
}

function emptyBuckets(): ClaimEvidenceBuckets {
  return { direct: [], contextual: [], contradicting: [] };
}

function indexEvidence(graph: EvidenceGraph): ReadonlyMap<string, ClaimEvidenceBuckets> {
  const index = new Map<string, ClaimEvidenceBuckets>();
  for (const node of graph.nodes) {
    if (node.kind === "CLAIM") index.set(node.id, emptyBuckets());
  }
  for (const edge of graph.edges) {
    const buckets = index.get(edge.from);
    if (!buckets) continue;
    if (edge.category === "DIRECT") buckets.direct.push(edge.to);
    else if (edge.category === "CONTEXTUAL") buckets.contextual.push(edge.to);
    else buckets.contradicting.push(edge.to);
  }
  return index;
}

function isRequired(claim: EvidenceClaim): boolean {
  return claim.required;
}

function requiresDirectEvidence(claim: EvidenceClaim): boolean {
  return claim.source === "ACCEPTANCE_CRITERION" || claim.required;
}

export class ClaimsVerifier {
  verify(intent: IntentSpec, graph: EvidenceGraph): ClaimsVerificationResult {
    if (graph.intentId !== intent.intentId || graph.contentHash !== intent.contentHash) {
      throw new ClaimsVerificationError("Intent and evidence graph identity mismatch");
    }

    const claimNodes = graph.nodes.filter((node) => node.kind === "CLAIM" && node.claim !== undefined);
    const observations = graph.nodes.filter((node) => node.kind === "OBSERVATION");
    const evidence = indexEvidence(graph);

    const claimResults = claimNodes
      .map((node) => {
        const claim = node.claim as EvidenceClaim;
        const buckets = evidence.get(node.id) ?? emptyBuckets();
        const contradicting = [...buckets.contradicting].sort();
        const direct = [...buckets.direct].sort();
        const contextual = [...buckets.contextual].sort();

        if (contradicting.length > 0) {
          return Object.freeze<ClaimVerificationResult>({
            claimId: claim.claimId,
            state: "REJECTED",
            directEvidence: direct,
            contextualEvidence: contextual,
            contradictingEvidence: contradicting,
            reason: "Contradicting evidence is present",
          });
        }

        if (observations.length === 0 || (requiresDirectEvidence(claim) && direct.length === 0)) {
          return Object.freeze<ClaimVerificationResult>({
            claimId: claim.claimId,
            state: "UNKNOWN",
            directEvidence: direct,
            contextualEvidence: contextual,
            contradictingEvidence: contradicting,
            reason: observations.length === 0 ? "No observations were collected" : "Required direct evidence is missing",
          });
        }

        return Object.freeze<ClaimVerificationResult>({
          claimId: claim.claimId,
          state: requiresDirectEvidence(claim) ? "VERIFIED" : "EVIDENCE-SUPPORTED",
          directEvidence: direct,
          contextualEvidence: contextual,
          contradictingEvidence: contradicting,
          reason: requiresDirectEvidence(claim) ? "Required direct evidence is present" : "Supporting evidence is present",
        });
      })
      .sort((a, b) => a.claimId.localeCompare(b.claimId));

    const requiredClaims = claimNodes.map((node) => node.claim as EvidenceClaim).filter(isRequired);
    const verifiedRequired = claimResults.filter((claim) => claim.state === "VERIFIED" && requiredClaims.some((required) => required.claimId === claim.claimId));
    const rejected = claimResults.filter((claim) => claim.state === "REJECTED");
    const unresolved = claimResults.filter((claim) => claim.state === "UNKNOWN");

    let state: ClaimsVerificationState;
    if (rejected.length > 0) state = "REJECTED";
    else if (requiredClaims.length > verifiedRequired.length) state = observations.length === 0 || unresolved.length > 0 ? "UNKNOWN" : "EVIDENCE-SUPPORTED";
    else if (observations.length === 0) state = "UNKNOWN";
    else state = "VERIFIED";

    const resultContent = {
      intentId: intent.intentId,
      graphHash: graph.graphHash,
      state,
      claims: claimResults,
      verifiedClaimIds: Object.freeze(verifiedRequired.map((claim) => claim.claimId).sort()),
      unresolvedClaimIds: Object.freeze(unresolved.map((claim) => claim.claimId).sort()),
      rejectedClaimIds: Object.freeze(rejected.map((claim) => claim.claimId).sort()),
    };

    return Object.freeze({ ...resultContent, verificationHash: digest(resultContent) });
  }
}
