import { createHash } from "node:crypto";
import type { EvidenceGraph } from "./EvidenceGraphBuilder.js";
import type { ClaimsVerificationResult } from "./ClaimsVerifier.js";

export type EpistemicAuditState = "UNKNOWN" | "CLAIMED" | "OBSERVED" | "EVIDENCE-SUPPORTED" | "VERIFIED" | "REJECTED";

export interface EpistemicAuditTransition {
  readonly from: EpistemicAuditState;
  readonly to: EpistemicAuditState;
  readonly reason: string;
  readonly sequence: number;
}

export interface EpistemicAuditRecord {
  readonly executionId: string;
  readonly intentId: string;
  readonly graphHash: string;
  readonly verificationHash: string;
  readonly state: EpistemicAuditState;
  readonly transitions: readonly EpistemicAuditTransition[];
  readonly proofDigest: string;
}

export class EpistemicAuditError extends Error {
  readonly code = "EPISTEMIC_AUDIT_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "EpistemicAuditError";
  }
}

const NEXT_STATE: Readonly<Record<EpistemicAuditState, EpistemicAuditState | undefined>> = Object.freeze({
  UNKNOWN: "CLAIMED",
  CLAIMED: "OBSERVED",
  OBSERVED: "EVIDENCE-SUPPORTED",
  "EVIDENCE-SUPPORTED": "VERIFIED",
  VERIFIED: undefined,
  REJECTED: undefined,
});

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

function freezeTransition(transition: EpistemicAuditTransition): EpistemicAuditTransition {
  return Object.freeze({ ...transition });
}

export class EpistemicAuditEngine {
  private readonly executionId: string;
  private readonly intentId: string;
  private state: EpistemicAuditState = "UNKNOWN";
  private readonly transitions: EpistemicAuditTransition[] = [];

  constructor(executionId: string, intentId: string) {
    if (!executionId.trim() || !intentId.trim()) throw new EpistemicAuditError("executionId and intentId are required");
    this.executionId = executionId;
    this.intentId = intentId;
  }

  get currentState(): EpistemicAuditState {
    return this.state;
  }

  claim(reason = "Execution claim registered"): void {
    this.advance("CLAIMED", reason);
  }

  observe(reason = "Execution observations collected"): void {
    this.advance("OBSERVED", reason);
  }

  support(reason = "Evidence supports execution claims"): void {
    this.advance("EVIDENCE-SUPPORTED", reason);
  }

  reject(reason = "Evidence contradicts execution claims"): void {
    if (this.state === "REJECTED") throw new EpistemicAuditError("Rejected audit is terminal");
    const transition = freezeTransition({ from: this.state, to: "REJECTED", reason, sequence: this.transitions.length });
    this.transitions.push(transition);
    this.state = "REJECTED";
  }

  applyVerification(result: ClaimsVerificationResult): void {
    if (result.intentId !== this.intentId) throw new EpistemicAuditError("Verification intent identity mismatch");
    if (result.state === "REJECTED") {
      this.reject("Claims verifier reported contradicting evidence");
      return;
    }
    if (result.state === "UNKNOWN") return;
    if (this.state !== "OBSERVED") throw new EpistemicAuditError(`Verification requires OBSERVED state; current state is ${this.state}`);
    if (result.state === "EVIDENCE-SUPPORTED") {
      this.support("Claims verifier found supporting but incomplete evidence");
      return;
    }
    this.support("Claims verifier found direct evidence for required claims");
    this.advance("VERIFIED", "All required claims have direct non-contradicted evidence");
  }

  prove(graph: EvidenceGraph, result: ClaimsVerificationResult): EpistemicAuditRecord {
    if (graph.graphHash !== result.graphHash) throw new EpistemicAuditError("Graph and verification hashes do not match");
    this.applyVerification(result);
    return this.finalize(graph.graphHash, result.verificationHash);
  }

  finalize(graphHash: string, verificationHash: string): EpistemicAuditRecord {
    if (!/^[a-f0-9]{64}$/.test(graphHash) || !/^[a-f0-9]{64}$/.test(verificationHash)) throw new EpistemicAuditError("Graph and verification hashes must be SHA-256 digests");
    const content = {
      executionId: this.executionId,
      intentId: this.intentId,
      graphHash,
      verificationHash,
      state: this.state,
      transitions: Object.freeze([...this.transitions]),
    };
    const proofDigest = digest(content);
    return Object.freeze({ ...content, proofDigest });
  }

  static verifyProof(record: EpistemicAuditRecord): boolean {
    const content = {
      executionId: record.executionId,
      intentId: record.intentId,
      graphHash: record.graphHash,
      verificationHash: record.verificationHash,
      state: record.state,
      transitions: record.transitions,
    };
    return digest(content) === record.proofDigest;
  }

  private advance(target: EpistemicAuditState, reason: string): void {
    if (this.state === "REJECTED") throw new EpistemicAuditError("Rejected audit is terminal");
    if (target === "REJECTED") return this.reject(reason);
    if (target === this.state) return;
    if (NEXT_STATE[this.state] !== target) throw new EpistemicAuditError(`Invalid epistemic transition: ${this.state} -> ${target}`);
    const transition = freezeTransition({ from: this.state, to: target, reason, sequence: this.transitions.length });
    this.transitions.push(transition);
    this.state = target;
  }
}
