import { digestJson, sha256 } from './crypto.js';
import { parseEvidenceRecord, parseVerificationObjective, ValidationError } from './validation.js';
export class EvidenceLedger {
    evidence = new Map();
    audit;
    constructor(audit) {
        this.audit = audit;
    }
    record(input) {
        const record = parseEvidenceRecord(input);
        if (this.evidence.has(record.evidenceId))
            throw new ValidationError(`duplicate evidenceId: ${record.evidenceId}`);
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
    get(evidenceId) {
        return this.evidence.get(evidenceId);
    }
    forObjective(objectiveId) {
        return Object.freeze([...this.evidence.values()].filter((record) => record.objectiveId === objectiveId));
    }
    digestForObjective(objectiveId) {
        const records = [...this.forObjective(objectiveId)]
            .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))
            .map((record) => this.recordDigest(record));
        return sha256(records.join('\n'));
    }
    recordDigest(record) {
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
    audit;
    evidence;
    constructor(audit, evidence) {
        this.audit = audit;
        this.evidence = evidence;
    }
    evaluate(input, nowEpochMs = Date.now()) {
        const objective = parseVerificationObjective(input);
        const records = this.evidence.forObjective(objective.objectiveId);
        const verified = records.filter((record) => record.verificationStatus === 'verified');
        const rejectedEvidenceIds = Object.freeze(records.filter((record) => record.verificationStatus === 'rejected').map((record) => record.evidenceId));
        const satisfiedInvariantIds = Object.freeze(objective.requiredInvariants
            .filter((invariant) => verified.some((record) => record.invariantIds.includes(invariant.invariantId)))
            .map((invariant) => invariant.invariantId));
        const missingInvariantIds = Object.freeze(objective.requiredInvariants
            .filter((invariant) => !satisfiedInvariantIds.includes(invariant.invariantId))
            .map((invariant) => invariant.invariantId));
        const acceptedEvidenceIds = Object.freeze(verified
            .filter((record) => record.invariantIds.some((id) => satisfiedInvariantIds.includes(id)))
            .map((record) => record.evidenceId));
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
//# sourceMappingURL=evidence.js.map