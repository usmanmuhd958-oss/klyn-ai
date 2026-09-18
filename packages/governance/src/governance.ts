import type { KeyObject } from "node:crypto";
import { AuditLedger } from "./audit.js";
import { ArtifactAttestor } from "./attestation.js";
import { ZeroTrustAuthorizer } from "./authorization.js";
import { CompletionGate, EvidenceLedger } from "./evidence.js";
import type {
  ArtifactAttestation,
  AuditEvent,
  AuthorizationDecision,
  CompletionDecision,
  EvidenceRecord,
  GovernanceSnapshot,
  ToolExecutionRequest,
} from "./types.js";
import type { AuditStorageAdapter } from "./audit-storage.js";
import { parseToolExecutionRequest } from "./validation.js";

export interface GovernanceEngineOptions {
  readonly auditStorage?: AuditStorageAdapter;
}

export class GovernanceEngine {
  public readonly audit: AuditLedger;
  public readonly evidence: EvidenceLedger;
  public readonly completion: CompletionGate;
  public readonly attestation: ArtifactAttestor;
  private readonly authorizer: ZeroTrustAuthorizer;

  public constructor(options: GovernanceEngineOptions = {}) {
    this.audit = new AuditLedger(options.auditStorage);
    this.evidence = new EvidenceLedger(this.audit);
    this.completion = new CompletionGate(this.audit, this.evidence);
    this.attestation = new ArtifactAttestor(this.audit, this.evidence, this.completion);
    this.authorizer = new ZeroTrustAuthorizer();
  }

  public authorize(requestInput: unknown, scopes: readonly unknown[], nowEpochMs = Date.now()): AuthorizationDecision {
    const decision = this.authorizer.authorize(requestInput, scopes, nowEpochMs);
    let request: ToolExecutionRequest | undefined;
    try {
      request = parseToolExecutionRequest(requestInput);
    } catch {
      request = undefined;
    }
    this.audit.append({
      kind: "authorization",
      requestId: decision.requestId,
      principalId: request?.principal.principalId ?? "unknown",
      toolName: request?.toolName ?? "unknown",
      operation: request?.operation ?? "unknown",
      decision: decision.allowed ? "allowed" : "denied",
      reason: decision.reason,
      ...(decision.scopeId === undefined ? {} : { scopeId: decision.scopeId }),
      timestampEpochMs: decision.evaluatedAtEpochMs,
    });
    return decision;
  }

  public recordEvidence(input: unknown): EvidenceRecord {
    return this.evidence.record(input);
  }

  public evaluateCompletion(objectiveInput: unknown, nowEpochMs = Date.now()): CompletionDecision {
    return this.completion.evaluate(objectiveInput, nowEpochMs);
  }

  public attestArtifact(
    manifestInput: unknown,
    objectiveInput: unknown,
    keyId: string,
    privateKey: KeyObject,
    nowEpochMs = Date.now(),
  ): ArtifactAttestation {
    return this.attestation.attest(manifestInput, objectiveInput, keyId, privateKey, nowEpochMs);
  }

  public appendAuditEvent(event: AuditEvent): void {
    this.audit.append(event);
  }

  public snapshot(): GovernanceSnapshot {
    return Object.freeze({
      auditHeadHash: this.audit.headHash(),
      auditLength: this.audit.length(),
      evidenceCount: this.totalEvidenceCount(),
    });
  }

  public close(): void {
    this.audit.close();
  }

  private totalEvidenceCount(): number {
    let count = 0;
    const records = this.audit.records();
    for (const record of records) if (record.event.kind === "evidence-recorded") count += 1;
    return count;
  }
}
