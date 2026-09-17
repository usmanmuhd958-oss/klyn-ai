import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import type { JsonValue } from './json.js';
import type { MissionEvidence, MissionGraph } from './types.js';

export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number cannot be canonicalized');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function digestJson(value: JsonValue): string {
  return sha256(canonicalize(value));
}

export function graphDigestInput(graph: Omit<MissionGraph, 'graphDigest'>): JsonValue {
  return {
    schemaVersion: graph.schemaVersion,
    missionId: graph.missionId,
    objectiveId: graph.objectiveId,
    nodes: graph.nodes,
    invariants: graph.invariants,
  } as unknown as JsonValue;
}

export function evidencePayload(evidence: Omit<MissionEvidence, 'payloadDigest' | 'signatureBase64'>): JsonValue {
  return {
    evidenceId: evidence.evidenceId,
    missionId: evidence.missionId,
    objectiveId: evidence.objectiveId,
    nodeId: evidence.nodeId,
    kind: evidence.kind,
    statement: evidence.statement,
    ...(evidence.artifactDigest === undefined ? {} : { artifactDigest: evidence.artifactDigest }),
    invariantIds: evidence.invariantIds,
    predecessorEvidenceIds: evidence.predecessorEvidenceIds,
    issuedAtEpochMs: evidence.issuedAtEpochMs,
    verifierId: evidence.verifierId,
  } as unknown as JsonValue;
}

export function evidencePayloadDigest(evidence: Omit<MissionEvidence, 'payloadDigest' | 'signatureBase64'>): string {
  return digestJson(evidencePayload(evidence));
}

export function signEvidence(evidence: Omit<MissionEvidence, 'payloadDigest' | 'signatureBase64'>, privateKey: KeyObject): { readonly payloadDigest: string; readonly signatureBase64: string } {
  const payloadDigest = evidencePayloadDigest(evidence);
  const signatureBase64 = sign(null, Buffer.from(payloadDigest, 'utf8'), privateKey).toString('base64');
  return Object.freeze({ payloadDigest, signatureBase64 });
}

export class Ed25519EvidenceVerifier {
  public readonly verifierId: string;
  private readonly publicKey: KeyObject;

  public constructor(verifierId: string, publicKey: KeyObject) {
    if (verifierId.length === 0) throw new Error('verifierId must be non-empty');
    this.verifierId = verifierId;
    this.publicKey = publicKey;
  }

  public verify(evidence: MissionEvidence): boolean {
    if (evidence.verifierId !== this.verifierId || evidence.signatureBase64 === undefined) return false;
    const unsigned = evidence as Omit<MissionEvidence, 'payloadDigest' | 'signatureBase64'> & { payloadDigest?: string; signatureBase64?: string };
    const expectedDigest = evidencePayloadDigest(unsigned);
    if (expectedDigest !== evidence.payloadDigest) return false;
    try {
      return verify(null, Buffer.from(evidence.payloadDigest, 'utf8'), this.publicKey, Buffer.from(evidence.signatureBase64, 'base64'));
    } catch {
      return false;
    }
  }
}
