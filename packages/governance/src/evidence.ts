import { digestJson, sha256 } from './crypto.js';
import { AuditLedger } from './audit.js';
import type { CompletionDecision, EvidenceRecord } from './types.js';
import { parseEvidenceRecord, parseVerificationObjective, ValidationError } from './validation.js';

export class EvidenceLedger {
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly audit: AuditLedger;

  public constructor(audit: AuditLedger) {
    this.audit = audit;
  }

  public record(input: unknown): EvidenceRecord {
    const record = parseEvidenceRecord(input);
    if (this.evidence.has(record.evidenceId)) throw new ValidationError(`duplicate evidenceId: ${record.evidenceId}`);
    this.evidence.set(record.evidenceId, record);
    this.audit.append({
      kind: 'evidence-recorded',
      evidenceId: record.evidenceId,
      objectiveId: record.objectiveId,
      verificationStatus: record.verificationStatus,
      evidenceDigest: this.recordDigest(record),
      timestampEpochMs: record.collectedAtEpochMs,
    });
    return record;
  }

  public get(evidenceId: string): EvidenceRecord | undefined {
    return this.evidence.get(evidenceId);
  }

  public forObjective(objectiveId: string): readonly EvidenceRecord[] {
    return Object.freeze([...this.evidence.values()].filter((record) => record.objectiveId === objectiveId));
  }

  public digestForObjective(objectiveId: string): string {
    const records = [...this.forObjective(objectiveId)]
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))
      .map((record) => this.recordDigest(record));
    return sha256(records.join('\n'));
  }

  public recordDigest(record: EvidenceRecord): string {
    return digestJson({
      evidenceId: record.evidenceId,
      objectiveId: record.objectiveId,
      kind: record.kind,
      statement: record.statement,
      source: record.source,
      payloadDigest: record.payloadDigest,
      invariantIds: record.invariantIds,
      verificationStatus: record.verificationStatus,
      verifierId: record.verifierId,
      collectedAtEpochMs: record.collectedAtEpochMs,
    });
  }
}

export class CompletionGate {
  private readonly audit: AuditLedger;
  private readonly evidence: EvidenceLedger;

  public constructor(audit: AuditLedger, evidence: EvidenceLedger) {
    this.audit = audit;
    this.evidence = evidence;
  }

  public evaluate(input: unknown, nowEpochMs = Date.now()): CompletionDecision {
    const objective = parseVerificationObjective(input);
    const records = this.evidence.forObjective(objective.objectiveId);
    const verified = records.filter((record) => record.verificationStatus === 'verified');
    const rejectedEvidenceIds = Object.freeze(records.filter((record) => record.verificationStatus === 'rejected').map((record) => record.evidenceId));
    const satisfiedInvariantIds = Object.freeze(
      objective.requiredInvariants
        .filter((invariant) => verified.some((record) => record.invariantIds.includes(invariant.invariantId)))
        .map((invariant) => invariant.invariantId),
    );
    const missingInvariantIds = Object.freeze(
      objective.requiredInvariants
        .filter((invariant) => !satisfiedInvariantIds.includes(invariant.invariantId))
        .map((invariant) => invariant.invariantId),
    );
    const acceptedEvidenceIds = Object.freeze(
      verified
        .filter((record) => record.invariantIds.some((id) => satisfiedInvariantIds.includes(id)))
        .map((record) => record.evidenceId),
    );
    const complete = missingInvariantIds.length === 0;
    const decisionReason = complete ? 'all-invariants-verified' : 'missing-verified-evidence';

    this.audit.append({
      kind: 'completion-gate',
      objectiveId: objective.objectiveId,
      decision: complete ? 'complete' : 'blocked',
      missingInvariantIds,
      acceptedEvidenceIds,
      timestampEpochMs: nowEpochMs,
    });

    return Object.freeze({
      objectiveId: objective.objectiveId,
      complete,
      satisfiedInvariantIds,
      missingInvariantIds,
      acceptedEvidenceIds,
      rejectedEvidenceIds,
      decisionReason,
      evaluatedAtEpochMs: nowEpochMs,
    });
  }
}
