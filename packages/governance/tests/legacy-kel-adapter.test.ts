import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { AuditLedger } from '../src/audit.js';
import { InMemoryAuditStorageAdapter, SqliteAuditStorageAdapter } from '../src/audit-storage.js';
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

test('SQLite outbox commits atomically with legacy audit and replays after transport failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kel-legacy-outbox-'));
  const databasePath = join(directory, 'governance.sqlite3');
  const pair = generateKeyPairSync('ed25519');
  let failOnce = true;
  const transport = {
    appendEvidence: async (envelope: DsseEnvelopeV1): Promise<KelAppendReceiptV1> => {
      if (failOnce) {
        failOnce = false;
        throw new Error('simulated daemon outage');
      }
      const statement = verifyDsseEnvelope(
        envelope,
        KEL_EVIDENCE_PAYLOAD_TYPE,
        new Map([['durable-producer', pair.publicKey]]),
      ) as unknown as EvidenceStatementV1;
      return receipt(statement.evidenceId, envelope);
    },
  };
  const event: AuditEvent = {
    kind: 'authorization',
    requestId: 'outbox-req-1',
    principalId: 'agent-1',
    toolName: 'git',
    operation: 'read',
    decision: 'allowed',
    reason: 'granted',
    timestampEpochMs: 1234,
  };

  try {
    const firstStorage = new SqliteAuditStorageAdapter(databasePath);
    const firstAudit = new AuditLedger(firstStorage);
    const adapter = new LegacyGovernanceKelAdapter(firstAudit, {} as ArtifactAttestor, {
      ledgerId: 'legacy-ledger',
      producerId: 'legacy-control-plane',
      producerKeyId: 'durable-producer',
      producerPrivateKey: pair.privateKey,
      transport,
      now: () => 1234,
    });
    const queued = await adapter.appendAudit(event);
    assert.equal(queued.queued, true);
    assert.equal(queued.receipt, null);
    assert.equal(firstAudit.length(), 1);
    assert.equal(firstAudit.pendingOutbox(10).length, 1);
    firstAudit.close();

    const restartedStorage = new SqliteAuditStorageAdapter(databasePath);
    const restartedAudit = new AuditLedger(restartedStorage);
    assert.equal(restartedAudit.length(), 1);
    const restartedAdapter = new LegacyGovernanceKelAdapter(restartedAudit, {} as ArtifactAttestor, {
      ledgerId: 'legacy-ledger',
      producerId: 'legacy-control-plane',
      producerKeyId: 'durable-producer',
      producerPrivateKey: pair.privateKey,
      transport,
      now: () => 1235,
    });
    const drained = await restartedAdapter.drainOutbox();
    assert.equal(drained.delivered, 1);
    assert.equal(drained.stillPending, 0);
    assert.equal(restartedAudit.pendingOutbox(10).length, 0);
    restartedAudit.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed outbox insert rolls back the associated SQLite audit record', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kel-outbox-atomicity-'));
  const databasePath = join(directory, 'atomic.sqlite3');
  const storage = new SqliteAuditStorageAdapter(databasePath);
  const audit = new AuditLedger(storage);
  const event: AuditEvent = {
    kind: 'authorization',
    requestId: 'atomic-req',
    principalId: 'agent-1',
    toolName: 'git',
    operation: 'read',
    decision: 'allowed',
    reason: 'granted',
    timestampEpochMs: 99,
  };
  const outbox = { eventId: 'unique-outbox-event', payloadJson: JSON.stringify({ evidence: [] }), createdAtEpochMs: '99' };
  try {
    audit.appendWithOutbox(event, () => outbox);
    assert.throws(() => audit.appendWithOutbox(event, () => outbox));
    assert.equal(audit.length(), 1);
    assert.equal(audit.pendingOutbox(10).length, 1);
    audit.close();
    const reopenedStorage = new SqliteAuditStorageAdapter(databasePath);
    const reopenedAudit = new AuditLedger(reopenedStorage);
    assert.equal(reopenedAudit.length(), 1, 'second audit write must roll back with duplicate outbox key');
    reopenedAudit.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
