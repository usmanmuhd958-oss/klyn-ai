import { createHash } from "node:crypto";

export interface PromotionAuditRecord {
  readonly sequence: number;
  readonly callId: string;
  readonly agentId: string;
  readonly intentId: string;
  readonly tool: "file-tree" | "git" | "bash" | "ast-patch";
  readonly requestHash: string;
  readonly resultHash: string;
  readonly previousAuditHash: string | null;
  readonly auditHash: string;
}

export interface TestEvidence {
  readonly suite: "cognitive-engine" | "execution-runtime" | "agent-core";
  readonly passed: number;
  readonly total: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface SelfHealingEvidence {
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly recovered: boolean;
  readonly exhausted: boolean;
  readonly unhandledErrors: number;
}

export interface ConsensusPromotionInput {
  readonly intentId: string;
  readonly auditTrail: readonly PromotionAuditRecord[];
  readonly testEvidence: readonly TestEvidence[];
  readonly selfHealing: SelfHealingEvidence;
  readonly noFrontendChanges: boolean;
  readonly coreInvariantsUnmodified: boolean;
  readonly certifiedSubstrates: readonly string[];
}

export interface AuditChainVerification {
  readonly valid: boolean;
  readonly rootIntentId: string;
  readonly terminalAuditHash: string | null;
  readonly failureReasons: readonly string[];
  readonly chainDigest: string;
}

export type ConsensusDecisionState = "APPROVED" | "REJECTED";

export interface ConsensusPromotionDecision {
  readonly state: ConsensusDecisionState;
  readonly targetCommit: string;
  readonly intentId: string;
  readonly auditChain: AuditChainVerification;
  readonly evidenceHash: string;
  readonly reasons: readonly string[];
  readonly decisionHash: string;
}

export const PHASE_7A_EXPECTED_TESTS = Object.freeze({
  "cognitive-engine": 79,
  "execution-runtime": 25,
  "agent-core": 7,
});

export const PHASE_7A_CERTIFIED_SUBSTRATES = Object.freeze([
  "fb9f11eb8882f6d427855f54ed56d0ed793722fd",
  "7e30523f20d20d99070c50ad75dc5893fd1cabf1",
  "7e595eda138b1a0cd58a751b3e8ce55f8b4876b0",
]);

const HEX_64 = /^[a-f0-9]{64}$/;
const SHA_40 = /^[a-f0-9]{40}$/;

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

function unsignedRecord(record: PromotionAuditRecord): Omit<PromotionAuditRecord, "auditHash"> {
  return {
    sequence: record.sequence,
    callId: record.callId,
    agentId: record.agentId,
    intentId: record.intentId,
    tool: record.tool,
    requestHash: record.requestHash,
    resultHash: record.resultHash,
    previousAuditHash: record.previousAuditHash,
  };
}

export function verifyAuditChain(
  records: readonly PromotionAuditRecord[],
  rootIntentId: string,
): AuditChainVerification {
  const failures: string[] = [];
  let previous: string | null = null;
  const seenCallIds = new Set<string>();

  if (!rootIntentId.trim()) failures.push("Root intentId is empty");
  if (records.length === 0) failures.push("Audit trail is empty");

  records.forEach((record, index) => {
    const expectedSequence = index + 1;
    if (record.sequence !== expectedSequence) {
      failures.push(`Audit sequence discontinuity at index ${index}: expected ${expectedSequence}, got ${record.sequence}`);
    }
    if (record.intentId !== rootIntentId) failures.push(`Audit intent mismatch at sequence ${record.sequence}`);
    if (seenCallIds.has(record.callId)) failures.push(`Duplicate audit callId: ${record.callId}`);
    seenCallIds.add(record.callId);
    if (!record.callId || !record.agentId || !record.tool) failures.push(`Incomplete audit metadata at sequence ${record.sequence}`);
    if (!HEX_64.test(record.requestHash) || !HEX_64.test(record.resultHash) || !HEX_64.test(record.auditHash)) {
      failures.push(`Non-SHA-256 audit digest at sequence ${record.sequence}`);
    }
    if (record.previousAuditHash !== previous) {
      failures.push(`Audit predecessor mismatch at sequence ${record.sequence}`);
    }

    const expectedAuditHash = sha256(unsignedRecord(record));
    if (record.auditHash !== expectedAuditHash) {
      failures.push(`Audit hash mismatch at sequence ${record.sequence}`);
    }

    previous = record.auditHash;
  });

  const chainDigest = sha256({
    rootIntentId,
    terminalAuditHash: previous,
    auditHashes: records.map((record) => record.auditHash),
  });

  return Object.freeze({
    valid: failures.length === 0,
    rootIntentId,
    terminalAuditHash: previous,
    failureReasons: Object.freeze([...failures]),
    chainDigest,
  });
}

export class ConsensusPromotionController {
  evaluate(input: ConsensusPromotionInput, targetCommit: string): ConsensusPromotionDecision {
    const auditChain = verifyAuditChain(input.auditTrail, input.intentId);
    const reasons: string[] = [...auditChain.failureReasons];

    if (!SHA_40.test(targetCommit)) reasons.push("Target commit must be a 40-character hexadecimal SHA");
    if (!this.hasExpectedSubstrates(input.certifiedSubstrates)) reasons.push("Certified substrate set does not match Phase 6A/6B/6C evidence");
    if (!input.noFrontendChanges) reasons.push("Frontend isolation policy failed");
    if (!input.coreInvariantsUnmodified) reasons.push("Core 1.0 invariants are not verified as unmodified");

    const evidenceBySuite = new Map(input.testEvidence.map((evidence) => [evidence.suite, evidence]));
    for (const suite of Object.keys(PHASE_7A_EXPECTED_TESTS) as Array<keyof typeof PHASE_7A_EXPECTED_TESTS>) {
      const evidence = evidenceBySuite.get(suite);
      const expected = PHASE_7A_EXPECTED_TESTS[suite];
      if (evidence === undefined) {
        reasons.push(`Missing test evidence for ${suite}`);
        continue;
      }
      if (evidence.total !== expected || evidence.passed !== expected || evidence.failed !== 0 || evidence.skipped !== 0) {
        reasons.push(`${suite} test evidence is not a 100% pass against the certified baseline`);
      }
    }
    if (input.testEvidence.length !== Object.keys(PHASE_7A_EXPECTED_TESTS).length) {
      reasons.push("Unexpected test evidence suites were supplied");
    }

    if (!Number.isInteger(input.selfHealing.attempts) || input.selfHealing.attempts < 1 || input.selfHealing.attempts > input.selfHealing.maxAttempts) {
      reasons.push("Self-healing attempt count is outside its declared bounded policy");
    }
    if (input.selfHealing.maxAttempts > 3) reasons.push("Self-healing maxAttempts exceeds Phase 6C bound of 3");
    if (!input.selfHealing.recovered) reasons.push("Self-healing recovery was not verified");
    if (input.selfHealing.exhausted) reasons.push("Self-healing entered an exhausted state");
    if (input.selfHealing.unhandledErrors !== 0) reasons.push("Unhandled self-healing errors are present");

    const evidenceHash = sha256({
      intentId: input.intentId,
      auditChain,
      testEvidence: input.testEvidence,
      selfHealing: input.selfHealing,
      certifiedSubstrates: input.certifiedSubstrates,
      noFrontendChanges: input.noFrontendChanges,
      coreInvariantsUnmodified: input.coreInvariantsUnmodified,
    });

    const state: ConsensusDecisionState = reasons.length === 0 ? "APPROVED" : "REJECTED";
    const decisionHash = sha256({
      state,
      targetCommit,
      intentId: input.intentId,
      auditChainHash: auditChain.chainDigest,
      evidenceHash,
      reasons,
    });

    return Object.freeze({
      state,
      targetCommit,
      intentId: input.intentId,
      auditChain,
      evidenceHash,
      reasons: Object.freeze([...reasons]),
      decisionHash,
    });
  }

  private hasExpectedSubstrates(actual: readonly string[]): boolean {
    if (actual.length !== PHASE_7A_CERTIFIED_SUBSTRATES.length) return false;
    return actual.every((sha, index) => sha === PHASE_7A_CERTIFIED_SUBSTRATES[index]);
  }
}
