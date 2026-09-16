import { createHash } from "node:crypto";

export interface ProductionTestSummary {
  readonly cognitiveEngine: { readonly passed: number; readonly total: number };
  readonly executionRuntime: { readonly passed: number; readonly total: number };
  readonly agentCore: { readonly passed: number; readonly total: number };
}

export interface ProductionPromotionSignoffInput {
  readonly decision: "APPROVED" | "REJECTED";
  readonly intentId: string;
  readonly targetCommit: string;
  readonly auditChainHash: string;
  readonly evidenceHash: string;
  readonly testSummary: ProductionTestSummary;
  readonly unhandledErrors: number;
  readonly certifiedSubstrates: readonly string[];
}

export interface ProductionPromotionSignoffArtifact {
  readonly artifactVersion: "7A-1.0.0";
  readonly policyId: "KLYN-CORE-1.0-PROMOTION-V1";
  readonly decision: "APPROVED" | "REJECTED";
  readonly intentId: string;
  readonly targetCommit: string;
  readonly auditChainHash: string;
  readonly evidenceHash: string;
  readonly testSummary: ProductionTestSummary;
  readonly unhandledErrors: number;
  readonly certifiedSubstrates: readonly string[];
  readonly artifactHash: string;
}

export class ProductionPromotionSignoffError extends Error {
  readonly code = "PRODUCTION_PROMOTION_SIGNOFF_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProductionPromotionSignoffError";
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

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export class ProductionPromotionSignoffEngine {
  create(input: ProductionPromotionSignoffInput): ProductionPromotionSignoffArtifact {
    if (input.decision !== "APPROVED") {
      throw new ProductionPromotionSignoffError("A production sign-off artifact may only be issued for APPROVED decisions");
    }
    if (!input.intentId.trim() || !/^[a-f0-9]{40}$/.test(input.targetCommit)) {
      throw new ProductionPromotionSignoffError("Intent and target commit identity are invalid");
    }
    if (!/^[a-f0-9]{64}$/.test(input.auditChainHash) || !/^[a-f0-9]{64}$/.test(input.evidenceHash)) {
      throw new ProductionPromotionSignoffError("Audit and evidence hashes must be SHA-256 digests");
    }
    if (input.unhandledErrors !== 0) {
      throw new ProductionPromotionSignoffError("Unhandled self-healing errors block production sign-off");
    }
    if (input.certifiedSubstrates.length !== 3 || input.certifiedSubstrates.some((sha) => !/^[a-f0-9]{40}$/.test(sha))) {
      throw new ProductionPromotionSignoffError("Exactly three valid certified substrate commits are required");
    }
    this.assertExactTestSummary(input.testSummary);

    const unsigned = {
      artifactVersion: "7A-1.0.0" as const,
      policyId: "KLYN-CORE-1.0-PROMOTION-V1" as const,
      decision: input.decision,
      intentId: input.intentId,
      targetCommit: input.targetCommit,
      auditChainHash: input.auditChainHash,
      evidenceHash: input.evidenceHash,
      testSummary: input.testSummary,
      unhandledErrors: input.unhandledErrors,
      certifiedSubstrates: Object.freeze([...input.certifiedSubstrates]),
    };

    return Object.freeze({ ...unsigned, artifactHash: sha256(unsigned) });
  }

  private assertExactTestSummary(summary: ProductionTestSummary): void {
    if (summary.cognitiveEngine.passed !== 79 || summary.cognitiveEngine.total !== 79) {
      throw new ProductionPromotionSignoffError("Cognitive-engine evidence must be exactly 79/79");
    }
    if (summary.executionRuntime.passed !== 25 || summary.executionRuntime.total !== 25) {
      throw new ProductionPromotionSignoffError("Execution-runtime evidence must be exactly 25/25");
    }
    if (summary.agentCore.passed !== 7 || summary.agentCore.total !== 7) {
      throw new ProductionPromotionSignoffError("Agent-core evidence must be exactly 7/7");
    }
  }

  static verify(artifact: ProductionPromotionSignoffArtifact): boolean {
    const unsigned = {
      artifactVersion: artifact.artifactVersion,
      policyId: artifact.policyId,
      decision: artifact.decision,
      intentId: artifact.intentId,
      targetCommit: artifact.targetCommit,
      auditChainHash: artifact.auditChainHash,
      evidenceHash: artifact.evidenceHash,
      testSummary: artifact.testSummary,
      unhandledErrors: artifact.unhandledErrors,
      certifiedSubstrates: artifact.certifiedSubstrates,
    };
    return sha256(unsigned) === artifact.artifactHash;
  }
}
