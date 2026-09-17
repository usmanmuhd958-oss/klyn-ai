import { type KeyObject } from 'node:crypto';
import { AuditLedger } from './audit.js';
import { canonicalize, digestJson, signEd25519, verifyEd25519 } from './crypto.js';
import type { ArtifactAttestation, ArtifactManifest } from './types.js';
import { parseArtifactManifest, ValidationError } from './validation.js';
import { CompletionGate, EvidenceLedger } from './evidence.js';

export class ArtifactAttestor {
  private readonly audit: AuditLedger;
  private readonly evidence: EvidenceLedger;
  private readonly completion: CompletionGate;

  public constructor(audit: AuditLedger, evidence: EvidenceLedger, completion: CompletionGate) {
    this.audit = audit;
    this.evidence = evidence;
    this.completion = completion;
  }

  public attest(manifestInput: unknown, objectiveInput: unknown, keyId: string, privateKey: KeyObject, nowEpochMs = Date.now()): ArtifactAttestation {
    const manifest = parseArtifactManifest(manifestInput);
    const completion = this.completion.evaluate(objectiveInput, nowEpochMs);
    if (!completion.complete || completion.objectiveId !== manifest.objectiveId) {
      throw new ValidationError('artifact cannot be attested before a complete matching verification objective');
    }
    if (completion.acceptedEvidenceIds.length === 0) {
      throw new ValidationError('artifact attestation requires accepted evidence');
    }

    const evidenceDigest = this.evidence.digestForObjective(manifest.objectiveId);
    const completionProofDigest = digestJson({
      objectiveId: completion.objectiveId,
      complete: completion.complete,
      satisfiedInvariantIds: completion.satisfiedInvariantIds,
      missingInvariantIds: completion.missingInvariantIds,
      acceptedEvidenceIds: completion.acceptedEvidenceIds,
      decisionReason: completion.decisionReason,
    });
    const payload = {
      version: 1 as const,
      algorithm: 'Ed25519' as const,
      keyId,
      artifact: {
        artifactId: manifest.artifactId,
        artifactKind: manifest.artifactKind,
        contentDigest: manifest.contentDigest,
        producerPrincipalId: manifest.producerPrincipalId,
        objectiveId: manifest.objectiveId,
        sourceCommitDigest: manifest.sourceCommitDigest,
        createdAtEpochMs: manifest.createdAtEpochMs,
      },
      evidenceDigest,
      auditHeadHash: this.audit.headHash(),
      completionProofDigest,
      attestedAtEpochMs: nowEpochMs,
    };
    const payloadDigest = digestJson(payload);
    const signatureBase64 = signEd25519(canonicalize(payload), privateKey);
    const attestation: ArtifactAttestation = Object.freeze({ ...payload, payloadDigest, signatureBase64 });

    this.audit.append({
      kind: 'artifact-attested',
      artifactId: manifest.artifactId,
      objectiveId: manifest.objectiveId,
      attestationPayloadDigest: payloadDigest,
      timestampEpochMs: nowEpochMs,
    });
    return attestation;
  }

  public verify(attestation: ArtifactAttestation, publicKey: KeyObject): boolean {
    const payload = {
      version: attestation.version,
      algorithm: attestation.algorithm,
      keyId: attestation.keyId,
      artifact: {
        artifactId: attestation.artifact.artifactId,
        artifactKind: attestation.artifact.artifactKind,
        contentDigest: attestation.artifact.contentDigest,
        producerPrincipalId: attestation.artifact.producerPrincipalId,
        objectiveId: attestation.artifact.objectiveId,
        sourceCommitDigest: attestation.artifact.sourceCommitDigest,
        createdAtEpochMs: attestation.artifact.createdAtEpochMs,
      },
      evidenceDigest: attestation.evidenceDigest,
      auditHeadHash: attestation.auditHeadHash,
      completionProofDigest: attestation.completionProofDigest,
      attestedAtEpochMs: attestation.attestedAtEpochMs,
    };
    return digestJson(payload) === attestation.payloadDigest && verifyEd25519(canonicalize(payload), attestation.signatureBase64, publicKey);
  }
}
