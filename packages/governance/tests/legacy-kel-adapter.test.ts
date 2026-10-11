import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { AuditLedger } from '../src/audit.js';
import { InMemoryAuditStorageAdapter } from '../src/audit-storage.js';
import {
  KEL_EVIDENCE_PAYLOAD_TYPE,
  verifyDsseEnvelope,
  type DsseEnvelopeV1,
  type EvidenceStatementV1,
  type KelAppendReceiptV1,
} from '../src/kel.js';
import { LegacyGovernanceKelAdapter } from '../src/legacy-kel-adapter.js';
import type { ArtifactAttestor } from '../src/attestation.js';
import type { AuditEvent } from '../src/types.js';

function receipt(evidenceId: string, envelope: DsseEnvelopeV1): KelAppendReceiptV1 {
  return {
    ledgerId: 'legacy-ledger',
    sequence: '1',
    evidenceId,
    envelopeDigest: 'sha256:' + '11'.repeat(32),
    leafHash: 'sha256:' + '22'.repeat(32),
    treeSize: '1',
    rootHash: 'sha256:' + '33'.repeat(32),
    checkpointEnvelope: envelope,
    idempotentReplay: false,
  };
}

test('legacy AuditLedger records can be signed and submitted without changing legacy record shape', async () => {
  const pair = generateKeyPairSync('ed25519');
  const audit = new AuditLedger(new InMemoryAuditStorageAdapter());
  const submitted: DsseEnvelopeV1[] = [];
  const transport = {
    appendEvidence: async (envelope: DsseEnvelopeV1): Promise<KelAppendReceiptV1> => {
      submitted.push(envelope);
      const statement = verifyDsseEnvelope(
        envelope,
        KEL_EVIDENCE_PAYLOAD_TYPE,
        new Map([['legacy-producer-key', pair.publicKey]]),
      ) as unknown as EvidenceStatementV1;
      return receipt(statement.evidenceId, envelope);
    },
  };
  const adapter = new LegacyGovernanceKelAdapter(
    audit,
    {} as ArtifactAttestor,
    {
      ledgerId: 'legacy-ledger',
      producerId: 'legacy-control-plane',
      producerKeyId: 'legacy-producer-key',
      producerPrivateKey: pair.privateKey,
      transport,
      now: () => 1234,
    },
  );
  const event: AuditEvent = {
    kind: 'authorization',
    requestId: 'req-1',
    principalId: 'agent-1',
    toolName: 'git',
    operation: 'read',
    decision: 'allowed',
    reason: 'granted',
    timestampEpochMs: 1200,
  };
  const result = await adapter.appendAudit(event);
  assert.equal(result.record.sequence, 1);
  assert.equal(result.record.event.kind, 'authorization');
  assert.ok(result.receipt);
  assert.equal(result.receipt.evidenceId, 'legacy-audit-1-' + result.record.hash.slice(0, 24));
  assert.equal(result.queued, false);
  assert.equal(submitted.length, 1);

  const statement = verifyDsseEnvelope(
    submitted[0]!,
    KEL_EVIDENCE_PAYLOAD_TYPE,
    new Map([['legacy-producer-key', pair.publicKey]]),
  ) as unknown as EvidenceStatementV1;
  assert.equal(statement.schema, 'urn:klyn:evidence:v1');
  assert.equal(statement.kind, 'authorization-decision');
  assert.equal(statement.outcome.status, 'pass');
  assert.equal(statement.extensions.legacySystem, 'AuditLedger');
  assert.equal(statement.extensions.legacyRecordHash, result.record.hash);
});
