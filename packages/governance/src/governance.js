import { AuditLedger } from './audit.js';
import { ArtifactAttestor } from './attestation.js';
import { ZeroTrustAuthorizer } from './authorization.js';
import { CompletionGate, EvidenceLedger } from './evidence.js';
import { parseToolExecutionRequest } from './validation.js';
export class GovernanceEngine {
    audit;
    evidence;
    completion;
    attestation;
    authorizer;
    constructor() {
        this.audit = new AuditLedger();
        this.evidence = new EvidenceLedger(this.audit);
        this.completion = new CompletionGate(this.audit, this.evidence);
        this.attestation = new ArtifactAttestor(this.audit, this.evidence, this.completion);
        this.authorizer = new ZeroTrustAuthorizer();
    }
    authorize(requestInput, scopes, nowEpochMs = Date.now()) {
        const decision = this.authorizer.authorize(requestInput, scopes, nowEpochMs);
        let request;
        try {
            request = parseToolExecutionRequest(requestInput);
        }
        catch {
            request = undefined;
        }
        this.audit.append({
            kind: 'authorization',
            requestId: decision.requestId,
            principalId: request?.principal.principalId ?? 'unknown',
            toolName: request?.toolName ?? 'unknown',
            operation: request?.operation ?? 'unknown',
            decision: decision.allowed ? 'allowed' : 'denied',
            reason: decision.reason,
            ...(decision.scopeId === undefined ? {} : { scopeId: decision.scopeId }),
            timestampEpochMs: decision.evaluatedAtEpochMs,
        });
        return decision;
    }
    recordEvidence(input) {
        return this.evidence.record(input);
    }
    evaluateCompletion(objectiveInput, nowEpochMs = Date.now()) {
        return this.completion.evaluate(objectiveInput, nowEpochMs);
    }
    attestArtifact(manifestInput, objectiveInput, keyId, privateKey, nowEpochMs = Date.now()) {
        return this.attestation.attest(manifestInput, objectiveInput, keyId, privateKey, nowEpochMs);
    }
    snapshot() {
        return Object.freeze({
            auditHeadHash: this.audit.headHash(),
            auditLength: this.audit.length(),
            evidenceCount: this.totalEvidenceCount(),
        });
    }
    totalEvidenceCount() {
        let count = 0;
        const records = this.audit.records();
        for (const record of records)
            if (record.event.kind === 'evidence-recorded')
                count += 1;
        return count;
    }
}
//# sourceMappingURL=governance.js.map