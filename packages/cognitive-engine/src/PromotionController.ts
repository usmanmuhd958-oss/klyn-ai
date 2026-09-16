import { createHash, sign, verify, type KeyObject } from "node:crypto";
import type { IntentSpec } from "./IntentSpec.js";
import type { EpistemicAuditRecord } from "./EpistemicAuditEngine.js";
import type { GovernanceEvaluation } from "./GovernancePolicyEngine.js";

export type PromotionState = "SANDBOX_STAGING" | "PRE_PROMOTION_AUDIT" | "PROMOTED" | "REJECTED_GOVERNANCE";

export interface PromotionSigner {
  readonly algorithm: "ed25519";
  sign(payload: Buffer): string;
  verify(payload: Buffer, signature: string): boolean;
}

export class Ed25519PromotionSigner implements PromotionSigner {
  readonly algorithm = "ed25519" as const;
  constructor(private readonly privateKey: KeyObject, private readonly publicKey: KeyObject) {}

  sign(payload: Buffer): string {
    return sign(null, payload, this.privateKey).toString("base64");
  }

  verify(payload: Buffer, signature: string): boolean {
    return verify(null, payload, this.publicKey, Buffer.from(signature, "base64"));
  }
}

export interface PromotionManifest {
  readonly manifestVersion: "1.0.0";
  readonly intentId: string;
  readonly target: string;
  readonly auditState: EpistemicAuditRecord["state"];
  readonly auditProofDigest: string;
  readonly graphHash: string;
  readonly verificationHash: string;
  readonly governanceEvaluationHash: string;
  readonly traceHashChain: readonly string[];
  readonly governanceViolations: readonly string[];
  readonly createdAt: number;
  readonly signerAlgorithm: "ed25519";
  readonly signature: string;
  readonly manifestHash: string;
}

export interface PromotionDecision {
  readonly state: PromotionState;
  readonly manifest?: PromotionManifest;
  readonly reason?: string;
}

export class PromotionError extends Error {
  readonly code = "PROMOTION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "PromotionError";
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

function traceChain(audit: EpistemicAuditRecord): readonly string[] {
  let previous = "0".repeat(64);
  const chain: string[] = [];
  for (const transition of audit.transitions) {
    const current = digest({ previous, transition });
    chain.push(current);
    previous = current;
  }
  return Object.freeze(chain);
}

export class PromotionController {
  private state: PromotionState = "SANDBOX_STAGING";

  get currentState(): PromotionState {
    return this.state;
  }

  beginPrePromotionAudit(): void {
    if (this.state !== "SANDBOX_STAGING") throw new PromotionError(`Cannot enter PRE_PROMOTION_AUDIT from ${this.state}`);
    this.state = "PRE_PROMOTION_AUDIT";
  }

  reject(reason: string): PromotionDecision {
    if (this.state === "PROMOTED") throw new PromotionError("Promoted state is terminal");
    this.state = "REJECTED_GOVERNANCE";
    return Object.freeze({ state: this.state, reason });
  }

  promote(intent: IntentSpec, audit: EpistemicAuditRecord, governance: GovernanceEvaluation, target: string, signer: PromotionSigner, createdAt: number): PromotionDecision {
    if (this.state !== "PRE_PROMOTION_AUDIT") throw new PromotionError(`Promotion requires PRE_PROMOTION_AUDIT, got ${this.state}`);
    if (!target.trim()) return this.reject("Promotion target is empty");
    if (audit.intentId !== intent.intentId || governance.intentId !== intent.intentId) return this.reject("Promotion identity mismatch");
    if (audit.state !== "VERIFIED") return this.reject(`Promotion requires VERIFIED audit state, got ${audit.state}`);
    if (!governance.promotable || governance.criticalViolationCount !== 0 || governance.violations.length !== 0) return this.reject("Governance policy does not permit promotion");
    if (!Number.isInteger(createdAt) || createdAt < 0) throw new PromotionError("createdAt must be a non-negative integer");

    const traceHashChain = traceChain(audit);
    const unsigned = {
      manifestVersion: "1.0.0" as const,
      intentId: intent.intentId,
      target,
      auditState: audit.state,
      auditProofDigest: audit.proofDigest,
      graphHash: audit.graphHash,
      verificationHash: audit.verificationHash,
      governanceEvaluationHash: governance.evaluationHash,
      traceHashChain,
      governanceViolations: Object.freeze([]) as readonly string[],
      createdAt,
      signerAlgorithm: "ed25519" as const,
    };
    const payload = Buffer.from(JSON.stringify(canonicalize(unsigned)), "utf8");
    const signature = signer.sign(payload);
    if (!signer.verify(payload, signature)) throw new PromotionError("Promotion signature self-verification failed");
    const manifestHash = digest({ ...unsigned, signature });
    const manifest = Object.freeze({ ...unsigned, signature, manifestHash });
    this.state = "PROMOTED";
    return Object.freeze({ state: this.state, manifest });
  }

  static verifyManifest(manifest: PromotionManifest, signer: PromotionSigner): boolean {
    const unsigned = {
      manifestVersion: manifest.manifestVersion,
      intentId: manifest.intentId,
      target: manifest.target,
      auditState: manifest.auditState,
      auditProofDigest: manifest.auditProofDigest,
      graphHash: manifest.graphHash,
      verificationHash: manifest.verificationHash,
      governanceEvaluationHash: manifest.governanceEvaluationHash,
      traceHashChain: manifest.traceHashChain,
      governanceViolations: manifest.governanceViolations,
      createdAt: manifest.createdAt,
      signerAlgorithm: manifest.signerAlgorithm,
    };
    const payload = Buffer.from(JSON.stringify(canonicalize(unsigned)), "utf8");
    return signer.verify(payload, manifest.signature) && digest({ ...unsigned, signature: manifest.signature }) === manifest.manifestHash;
  }
}
