import { type KeyObject } from 'node:crypto';
import { AuditLedger } from './audit.js';
import { ArtifactAttestor } from './attestation.js';
import {
  KEL_EVIDENCE_PAYLOAD_TYPE,
  canonicalizeJcs,
  digestJcs,
  dssePreAuthEncoding,
  type DsseEnvelopeV1,
  type EvidenceStatementV1,
  type KelAppendReceiptV1,
  type KelDaemonTransport,
  type KelEvidenceKind,
  type KelEvidenceStatus,
} from './kel.js';
import { signEd25519 } from './crypto.js';
import type { AuditOutboxItem, AuditOutboxRecord } from './audit-storage.js';
import type { ArtifactAttestation, AuditEvent, AuditRecord, JsonValue } from './types.js';

export interface LegacyKelAdapterOptions {
  readonly ledgerId: string;
  readonly producerId: string;
  readonly producerKeyId: string;
  readonly producerPrivateKey: KeyObject;
  readonly transport: Pick<KelDaemonTransport, 'appendEvidence'>;
  readonly repositoryUri?: string;
  readonly now?: () => number;
}
export interface LegacyAuditAppendResult {
  readonly record: AuditRecord;
  /** Null means the legacy record and KEL event are durable in the outbox but not delivered yet. */
  readonly receipt: KelAppendReceiptV1 | null;
  readonly queued: boolean;
  readonly outboxEventId: string;
}
export interface LegacyArtifactAttestationResult {
  readonly attestation: ArtifactAttestation;
  readonly auditReceipt: KelAppendReceiptV1 | null;
  readonly artifactReceipt: KelAppendReceiptV1 | null;
  readonly queued: boolean;
  readonly outboxEventId: string;
}
interface LegacyOutboxEvidenceV1 {
  readonly evidenceId: string;
  readonly envelope: DsseEnvelopeV1;
}
interface LegacyOutboxPayloadV1 {
  readonly schema: 'urn:klyn:legacy-kel-outbox:v1';
  readonly evidence: readonly LegacyOutboxEvidenceV1[];
}
export interface LegacyOutboxDrainResult {
  readonly processed: number;
  readonly delivered: number;
  readonly stillPending: number;
  readonly failures: readonly { readonly eventId: string; readonly message: string }[];
  readonly receiptsByEventId: ReadonlyMap<string, readonly KelAppendReceiptV1[]>;
}

function statusFromAuditEvent(event: AuditEvent): KelEvidenceStatus {
  switch (event.kind) {
    case 'authorization':
      return event.decision === 'allowed' ? 'pass' : 'blocked';
    case 'evidence-recorded':
      return event.verificationStatus === 'verified' ? 'pass' : 'fail';
    case 'completion-gate':
      return event.decision === 'complete' ? 'pass' : 'blocked';
    case 'artifact-attested':
      return 'pass';
    case 'containment':
      return event.action === 'CONTINUE' ? 'pass' : event.action === 'WARN' ? 'unknown' : 'blocked';
    default:
      throw new TypeError('unsupported legacy audit event kind');
  }
}

function kindFromAuditEvent(event: AuditEvent): KelEvidenceKind {
  switch (event.kind) {
    case 'authorization': return 'authorization-decision';
    case 'evidence-recorded':
    case 'completion-gate': return 'verification-completed';
    case 'artifact-attested': return 'mutation-committed';
    case 'containment': return 'execution-completed';
    default: throw new TypeError('unsupported legacy audit event kind');
  }
}
function jsonValue(value: unknown): JsonValue {
  const normalized: unknown = JSON.parse(JSON.stringify(value)) as unknown;
  if (normalized === null || typeof normalized === 'string' || typeof normalized === 'number' ||
      typeof normalized === 'boolean') return normalized;
  if (Array.isArray(normalized)) return normalized.map((item) => jsonValue(item));
  if (typeof normalized === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(normalized as Record<string, unknown>)) {
      result[key] = jsonValue(child);
    }
    return result;
  }
  throw new TypeError('legacy input is not JSON serializable');
}

function envelopeFor(statement: EvidenceStatementV1, keyId: string, privateKey: KeyObject): DsseEnvelopeV1 {
  const payloadBytes = Buffer.from(canonicalizeJcs(statement), 'utf8');
  const pae = Buffer.from(dssePreAuthEncoding(KEL_EVIDENCE_PAYLOAD_TYPE, payloadBytes)).toString('utf8');
  return {
    payloadType: KEL_EVIDENCE_PAYLOAD_TYPE,
    payload: payloadBytes.toString('base64'),
    signatures: [{ keyid: keyId, sig: signEd25519(pae, privateKey) }],
  };
}

/**
 * Backward-compatible migration facade.
 *
 * Keep existing AuditLedger and ArtifactAttestor instances intact, then route calls
 * requiring KEL durability through appendAudit() and attestArtifact(). The adapter
 * preserves the legacy return objects and adds the KEL receipts. A local legacy
 * append and the remote ledger append cannot be one ACID transaction; evidence IDs
 * are deterministic, so transport retries are idempotent. Deployments that require
 * zero-loss migration should drain a durable outbox before acknowledging the caller.
 */
export class LegacyGovernanceKelAdapter {
  private readonly ledgerId: string;
  private readonly producerId: string;
  private readonly producerKeyId: string;
  private readonly producerPrivateKey: KeyObject;
  private readonly transport: Pick<KelDaemonTransport, 'appendEvidence'>;
  private readonly repositoryUri: string;
  private readonly now: () => number;

  public constructor(
    private readonly audit: AuditLedger,
    private readonly attestor: ArtifactAttestor,
    options: LegacyKelAdapterOptions,
  ) {
    if (!options.ledgerId || !options.producerId || !options.producerKeyId) {
      throw new TypeError('ledgerId, producerId and producerKeyId are required');
    }
    if (options.producerPrivateKey.type !== 'private' ||
        options.producerPrivateKey.asymmetricKeyType !== 'ed25519') {
      throw new TypeError('producerPrivateKey must be an Ed25519 private key');
    }
    this.ledgerId = options.ledgerId;
    this.producerId = options.producerId;
    this.producerKeyId = options.producerKeyId;
    this.producerPrivateKey = options.producerPrivateKey;
    this.transport = options.transport;
    this.repositoryUri = options.repositoryUri ?? 'urn:klyn:legacy-governance';
    this.now = options.now ?? Date.now;
  }

  /**
   * Appends the legacy audit event and its complete KEL envelope to the same SQLite
   * transaction. A failed network delivery leaves the payload durable for replay.
   */
  public async appendAudit(event: AuditEvent): Promise<LegacyAuditAppendResult> {
    let outboxEventId = '';
    const record = this.audit.appendWithOutbox(event, (nextRecord) => {
      const statement = this.statementFromAuditRecord(nextRecord);
      const envelope = envelopeFor(statement, this.producerKeyId, this.producerPrivateKey);
      outboxEventId = this.outboxId(nextRecord);
      return this.makeOutboxItem(outboxEventId, [ { evidenceId: statement.evidenceId, envelope } ]);
    });
    const drained = await this.drainOutbox();
    const receipt = drained.receiptsByEventId.get(outboxEventId)?.[0] ?? null;
    return { record, receipt, queued: receipt === null, outboxEventId };
  }

  /**
   * The attestor's legacy audit append and both KEL envelopes are committed atomically
   * by AuditLedger's storage adapter. If the KEL daemon is unavailable the whole bundle
   * remains pending; a replay is idempotent for evidence already appended remotely.
   */
  public async attestArtifact(
    manifestInput: unknown,
    objectiveInput: unknown,
    keyId: string,
    privateKey: KeyObject,
    nowEpochMs = this.now(),
  ): Promise<LegacyArtifactAttestationResult> {
    let outboxEventId = '';
    const attestation = this.attestor.attest(
      manifestInput,
      objectiveInput,
      keyId,
      privateKey,
      nowEpochMs,
      (record, value) => {
        if (!record || record.event.kind !== 'artifact-attested' ||
            record.event.attestationPayloadDigest !== value.payloadDigest) {
          throw new Error('ArtifactAttestor generated an inconsistent audit/outbox record');
        }
        const auditStatement = this.statementFromAuditRecord(record);
        const artifactStatement = this.statementFromArtifactAttestation(value);
        const auditEnvelope = envelopeFor(auditStatement, this.producerKeyId, this.producerPrivateKey);
        const artifactEnvelope = envelopeFor(artifactStatement, this.producerKeyId, this.producerPrivateKey);
        outboxEventId = this.outboxId(record);
        return this.makeOutboxItem(outboxEventId, [
          { evidenceId: auditStatement.evidenceId, envelope: auditEnvelope },
          { evidenceId: artifactStatement.evidenceId, envelope: artifactEnvelope },
        ]);
      },
    );
    const drained = await this.drainOutbox();
    const receipts = drained.receiptsByEventId.get(outboxEventId) ?? [];
    return {
      attestation,
      auditReceipt: receipts[0] ?? null,
      artifactReceipt: receipts[1] ?? null,
      queued: receipts.length !== 2,
      outboxEventId,
    };
  }

  /** Drain durable events in order. Failures remain pending and are replayable. */
  public async drainOutbox(limit = 100): Promise<LegacyOutboxDrainResult> {
    const pending: readonly AuditOutboxRecord[] = this.audit.pendingOutbox(limit);
    const failures: Array<{ eventId: string; message: string }> = [];
    const receiptsByEventId = new Map<string, readonly KelAppendReceiptV1[]>();
    let delivered = 0;

    for (const item of pending) {
      try {
        const payload = JSON.parse(item.payloadJson) as LegacyOutboxPayloadV1;
        if (payload.schema !== 'urn:klyn:legacy-kel-outbox:v1' ||
            !Array.isArray(payload.evidence) || payload.evidence.length === 0) {
          throw new Error('outbox payload schema is invalid');
        }
        const receipts: KelAppendReceiptV1[] = [];
        for (const evidence of payload.evidence) {
          if (!evidence.evidenceId || !evidence.envelope) throw new Error('outbox evidence entry is incomplete');
          const receipt = await this.transport.appendEvidence(evidence.envelope, String(this.now()));
          if (receipt.evidenceId !== evidence.evidenceId) throw new Error('KEL receipt evidence ID mismatch');
          receipts.push(receipt);
        }
        this.audit.markOutboxDelivered(item.eventId, JSON.stringify(receipts));
        receiptsByEventId.set(item.eventId, receipts);
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try { this.audit.markOutboxFailure(item.eventId, message); } catch { /* retain original failure */ }
        failures.push({ eventId: item.eventId, message });
        // Preserve strict order: don't deliver later entries after an earlier failure.
        break;
      }
    }
    const stillPending = this.audit.pendingOutbox(1000).length;
    return { processed: pending.length, delivered, stillPending, failures, receiptsByEventId };
  }

  private outboxId(record: AuditRecord): string {
    return 'kel-outbox-' + String(record.sequence) + '-' + record.hash.slice(0, 24);
  }

  private makeOutboxItem(eventId: string, evidence: readonly LegacyOutboxEvidenceV1[]): AuditOutboxItem {
    const payload: LegacyOutboxPayloadV1 = { schema: 'urn:klyn:legacy-kel-outbox:v1', evidence };
    return {
      eventId,
      payloadJson: JSON.stringify(payload),
      createdAtEpochMs: String(this.now()),
    };
  }

  private statementFromAuditRecord(record: AuditRecord): EvidenceStatementV1 {
    const eventJson = jsonValue(record.event);
    const timestamp = String(record.event.timestampEpochMs);
    const digest = digestJcs(eventJson);
    const sourceHash = 'sha256:' + record.hash;
    return {
      schema: 'urn:klyn:evidence:v1',
      ledgerId: this.ledgerId,
      evidenceId: 'legacy-audit-' + String(record.sequence) + '-' + record.hash.slice(0, 24),
      runId: 'legacy-audit-ledger',
      sequenceInRun: String(record.sequence),
      kind: kindFromAuditEvent(record.event),
      producerId: this.producerId,
      context: {
        intentDigest: digestJcs({ purpose: 'legacy-intent', event: eventJson }),
        planDigest: digestJcs({ purpose: 'legacy-plan', event: eventJson }),
        policyDigest: digestJcs({ purpose: 'legacy-policy', event: eventJson }),
        sourceTreeDigest: sourceHash,
        runtimeImageDigest: digestJcs({ runtime: 'legacy-governance-adapter', schema: 1 }),
      },
      subject: {
        repositoryUri: this.repositoryUri,
        baseRevision: record.previousHash,
        resultingTreeDigest: null,
        changeDigest: digest,
      },
      outcome: {
        status: statusFromAuditEvent(record.event),
        exitCode: null,
        stdoutDigest: null,
        stderrDigest: null,
        startedAtEpochMs: timestamp,
        finishedAtEpochMs: timestamp,
      },
      artifacts: [],
      extensions: {
        legacySystem: 'AuditLedger',
        legacySequence: String(record.sequence),
        legacyRecordHash: record.hash,
        legacyEvent: eventJson,
      },
    };
  }

  private statementFromArtifactAttestation(attestation: ArtifactAttestation): EvidenceStatementV1 {
    const timestamp = String(attestation.attestedAtEpochMs);
    const artifact = attestation.artifact;
    return {
      schema: 'urn:klyn:evidence:v1',
      ledgerId: this.ledgerId,
      evidenceId: 'legacy-artifact-attestation-' + attestation.payloadDigest,
      runId: artifact.objectiveId,
      sequenceInRun: '1',
      kind: 'mutation-committed',
      producerId: this.producerId,
      context: {
        intentDigest: digestJcs({ objectiveId: artifact.objectiveId, purpose: 'legacy-artifact-intent' }),
        planDigest: digestJcs({ completionProofDigest: attestation.completionProofDigest }),
        policyDigest: digestJcs({ purpose: 'legacy-artifact-attestation', version: attestation.version }),
        sourceTreeDigest: artifact.sourceCommitDigest,
        runtimeImageDigest: digestJcs({ runtime: 'legacy-governance-adapter', schema: 1 }),
      },
      subject: {
        repositoryUri: this.repositoryUri,
        baseRevision: artifact.sourceCommitDigest,
        resultingTreeDigest: artifact.sourceCommitDigest,
        changeDigest: artifact.contentDigest,
      },
      outcome: {
        status: 'pass',
        exitCode: '0',
        stdoutDigest: null,
        stderrDigest: null,
        startedAtEpochMs: timestamp,
        finishedAtEpochMs: timestamp,
      },
      artifacts: [{
        name: artifact.artifactId,
        mediaType: 'application/octet-stream',
        sizeBytes: '0',
        digest: artifact.contentDigest,
      }],
      extensions: {
        legacySystem: 'ArtifactAttestor',
        attestationPayloadDigest: attestation.payloadDigest,
        completionProofDigest: attestation.completionProofDigest,
        legacyAuditHeadHash: attestation.auditHeadHash,
        artifactKind: artifact.artifactKind,
        manifest: jsonValue(artifact),
      },
    };
  }
}
