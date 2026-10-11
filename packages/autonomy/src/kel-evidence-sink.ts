/**
 * Concrete bridge from capability events into KEL v1 DSSE EvidenceStatementV1.
 *
 * The signer, mission context resolver, durable sequence allocator, and KEL transport
 * are explicit trusted dependencies. No fallback/local-only evidence path is provided:
 * failure to sign, append, verify, or reserve a stable sequence fails closed.
 */
import {
  canonicalizeJcs,
  digestJcs,
  dssePreAuthEncoding,
  KEL_EVIDENCE_PAYLOAD_TYPE,
  validateEvidenceStatement,
} from "@klyn/governance";
import type {
  DsseEnvelopeV1,
  EvidenceContextV1,
  EvidenceStatementV1,
  EvidenceSubjectV1,
  KelAppendReceiptV1,
  VerificationReportV1,
} from "@klyn/governance";
import type {
  CapabilityEvidenceEvent,
  CapabilityEvidenceReceipt,
  CapabilityEvidenceSink,
} from "./capability.js";

export interface CapabilityKelProducerSigner {
  /** Key ID must be pinned in the trusted producer-key registry used by KelBridge. */
  readonly keyId: string;
  /** Signs the exact DSSE pre-authentication encoding bytes with the KEL producer key. */
  signPae(pae: Uint8Array): Promise<string>;
}

export interface CapabilityKelSequenceAllocator {
  /**
   * Atomically allocates a decimal sequence within a run. Repeating the same runId
   * and eventId must return the same value so retries preserve an identical payload.
   * The backing implementation must be durable and linearizable across workers.
   */
  reserveSequence(runId: string, eventId: string): Promise<string>;
}

export interface CapabilityKelBridge {
  submit(
    envelope: DsseEnvelopeV1,
    acceptedAtEpochMs: string,
  ): Promise<{ readonly receipt: KelAppendReceiptV1; readonly verification: VerificationReportV1 }>;
}

export interface CapabilityKelEvidenceSinkOptions {
  readonly ledgerId: string;
  /** Trusted KEL producer principal, not the untrusted capability subject. */
  readonly producerId: string;
  readonly signer: CapabilityKelProducerSigner;
  readonly bridge: CapabilityKelBridge;
  readonly sequences: CapabilityKelSequenceAllocator;
  readonly runIdForEvent: (event: CapabilityEvidenceEvent) => string;
  /** Must resolve authoritative mission policy/source/runtime context digests. */
  readonly contextForEvent: (event: CapabilityEvidenceEvent) => Promise<EvidenceContextV1>;
  /** Resolves the true subject/resource context; the adapter does not fabricate repository metadata. */
  readonly subjectForEvent: (event: CapabilityEvidenceEvent) => Promise<EvidenceSubjectV1>;
  readonly now?: () => number;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function requiredId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(label + " is not a valid canonical identifier");
  }
}

function asKelDigest(value: string, label: string): string {
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value;
  throw new TypeError(label + " must be sha256: followed by 64 lowercase hexadecimal characters");
}

function asEventDigest(value: string | null, label: string): string | null {
  if (value === null) return null;
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(label + " must be lowercase SHA-256 hex or null");
  }
  return "sha256:" + value;
}

function kelKind(event: CapabilityEvidenceEvent): EvidenceStatementV1["kind"] {
  return event.kind === "capability-invocation-completed" ||
    event.kind === "capability-invocation-failed"
    ? "execution-completed"
    : "authorization-decision";
}

function kelStatus(event: CapabilityEvidenceEvent): EvidenceStatementV1["outcome"]["status"] {
  switch (event.outcome) {
    case "allowed":
    case "completed":
      return "pass";
    case "failed":
      return "fail";
    case "denied":
    case "revoked":
      return "blocked";
  }
}

/**
 * Durably writes an OCap lifecycle event to the KEL v1 ledger and returns only after
 * the bridge confirms that the statement is accepted and its signatures/inclusion/
 * configured verification policy pass. A pending/unverified ledger entry is not enough
 * to authorize a protected action.
 */
export class CapabilityKelEvidenceSink implements CapabilityEvidenceSink {
  private readonly now: () => number;

  public constructor(private readonly options: CapabilityKelEvidenceSinkOptions) {
    this.now = options.now ?? Date.now;
    requiredId(options.ledgerId, "ledgerId");
    requiredId(options.producerId, "producerId");
    requiredId(options.signer.keyId, "signer.keyId");
  }

  public async append(event: CapabilityEvidenceEvent): Promise<CapabilityEvidenceReceipt> {
    requiredId(event.eventId, "event.eventId");
    requiredId(event.principalId, "event.principalId");
    requiredId(event.missionId, "event.missionId");
    requiredId(event.runtimeInstanceId, "event.runtimeInstanceId");
    requiredId(event.tokenId, "event.tokenId");
    requiredId(event.policyDigest, "event.policyDigest");
    if (!Number.isSafeInteger(event.occurredAtEpochMs) || event.occurredAtEpochMs < 0) {
      throw new TypeError("event.occurredAtEpochMs must be a non-negative safe integer");
    }
    if (!/^[a-f0-9]{64}$/.test(event.tokenDigest)) throw new TypeError("event.tokenDigest must be SHA-256 hex");
    if (event.parentTokenDigest !== null && !/^[a-f0-9]{64}$/.test(event.parentTokenDigest)) {
      throw new TypeError("event.parentTokenDigest must be SHA-256 hex or null");
    }
    if (event.requestDigest !== null && !/^[a-f0-9]{64}$/.test(event.requestDigest)) {
      throw new TypeError("event.requestDigest must be SHA-256 hex or null");
    }
    if (event.invocationId !== null) requiredId(event.invocationId, "event.invocationId");

    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("KEL adapter clock returned an invalid time");
    const runId = this.options.runIdForEvent(event);
    requiredId(runId, "runId");
    const [context, subject, sequenceInRun] = await Promise.all([
      this.options.contextForEvent(event),
      this.options.subjectForEvent(event),
      this.options.sequences.reserveSequence(runId, event.eventId),
    ]);
    if (!/^(0|[1-9][0-9]*)$/.test(sequenceInRun)) {
      throw new TypeError("KEL sequence allocator must return a canonical decimal integer string");
    }
    const resolvedPolicyDigest = asKelDigest(context.policyDigest, "context.policyDigest");
    if (resolvedPolicyDigest !== "sha256:" + event.policyDigest) {
      throw new TypeError("KEL policy context digest must match the signed capability policyDigest claim");
    }

    const status = kelStatus(event);
    const statement: EvidenceStatementV1 = Object.freeze({
      schema: "urn:klyn:evidence:v1",
      ledgerId: this.options.ledgerId,
      evidenceId: event.eventId,
      runId,
      sequenceInRun,
      kind: kelKind(event),
      producerId: this.options.producerId,
      context: Object.freeze({
        intentDigest: asKelDigest(context.intentDigest, "context.intentDigest"),
        planDigest: asKelDigest(context.planDigest, "context.planDigest"),
        policyDigest: resolvedPolicyDigest,
        sourceTreeDigest: asKelDigest(context.sourceTreeDigest, "context.sourceTreeDigest"),
        runtimeImageDigest: asKelDigest(context.runtimeImageDigest, "context.runtimeImageDigest"),
      }),
      subject: Object.freeze({
        repositoryUri: subject.repositoryUri,
        baseRevision: subject.baseRevision,
        resultingTreeDigest: subject.resultingTreeDigest === null
          ? null
          : asKelDigest(subject.resultingTreeDigest, "subject.resultingTreeDigest"),
        changeDigest: subject.changeDigest === null
          ? null
          : asKelDigest(subject.changeDigest, "subject.changeDigest"),
      }),
      outcome: Object.freeze({
        status,
        exitCode: status === "pass" ? "0" : status === "fail" ? "1" : null,
        stdoutDigest: null,
        stderrDigest: null,
        startedAtEpochMs: String(event.occurredAtEpochMs),
        finishedAtEpochMs: String(event.occurredAtEpochMs),
      }),
      artifacts: Object.freeze([]),
      extensions: Object.freeze({
        capabilitySchema: event.schema,
        capabilityEventKind: event.kind,
        capabilityPrincipalId: event.principalId,
        missionId: event.missionId,
        runtimeInstanceId: event.runtimeInstanceId,
        tokenId: event.tokenId,
        tokenDigest: event.tokenDigest,
        parentTokenDigest: event.parentTokenDigest,
        invocationId: event.invocationId,
        requestDigest: event.requestDigest,
        policyDigestClaim: event.policyDigest,
        capabilityOutcome: event.outcome,
        reasonCode: event.reasonCode,
        details: event.details,
      }),
    });

    validateEvidenceStatement(statement);
    const payloadBytes = Buffer.from(canonicalizeJcs(statement), "utf8");
    const pae = dssePreAuthEncoding(KEL_EVIDENCE_PAYLOAD_TYPE, payloadBytes);
    const signatureBase64 = await this.options.signer.signPae(pae);
    if (!BASE64_PATTERN.test(signatureBase64)) {
      throw new TypeError("KEL producer signer returned malformed Base64");
    }
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    if (signatureBytes.length !== 64 || signatureBytes.toString("base64") !== signatureBase64) {
      throw new TypeError("KEL producer signer must return a canonical 64-byte Ed25519 signature");
    }
    const envelope: DsseEnvelopeV1 = Object.freeze({
      payloadType: KEL_EVIDENCE_PAYLOAD_TYPE,
      payload: payloadBytes.toString("base64"),
      signatures: Object.freeze([Object.freeze({ keyid: this.options.signer.keyId, sig: signatureBase64 })]),
    });

    const result = await this.options.bridge.submit(envelope, String(now));
    if (!result.verification.accepted) {
      throw new Error(
        "KEL did not accept capability evidence: " + result.verification.reasonCodes.join(", "),
      );
    }
    if (result.receipt.ledgerId !== statement.ledgerId || result.receipt.evidenceId !== statement.evidenceId) {
      throw new Error("KEL receipt does not bind the exact capability evidence statement");
    }

    return Object.freeze({
      ledgerId: result.receipt.ledgerId,
      evidenceId: result.receipt.evidenceId,
      statementDigest: digestJcs(statement).slice("sha256:".length),
      // This is the time the adapter observed verified ledger acceptance, not a
      // timestamp claimed by an untrusted producer inside the statement.
      committedAtEpochMs: this.now(),
    });
  }
}
