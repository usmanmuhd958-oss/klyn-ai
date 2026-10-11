import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteWitnessReceiptStore } from '../src/witness-network.js';
import type { WitnessSignatureV1 } from '../src/witness.js';

test('SQLite witness receipt storage is durable and rejects conflicting signatures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kel-witness-receipts-'));
  const databasePath = join(directory, 'receipts.sqlite3');
  const checkpointDigest = 'sha256:' + 'ab'.repeat(32);
  const signature: WitnessSignatureV1 = {
    witnessId: 'witness-1',
    keyId: 'witness-key-1',
    keyEpoch: '4',
    signatureBase64: Buffer.alloc(64, 7).toString('base64'),
  };
  try {
    const store = new SqliteWitnessReceiptStore(databasePath);
    store.put(checkpointDigest, signature, '100');
    store.put(checkpointDigest, signature, '101');
    assert.deepEqual(store.list(checkpointDigest), [signature]);
    assert.throws(() => store.put(checkpointDigest, {
      ...signature,
      signatureBase64: Buffer.alloc(64, 8).toString('base64'),
    }, '102'), /conflicting receipt/);
    store.close();

    const reopened = new SqliteWitnessReceiptStore(databasePath);
    assert.deepEqual(reopened.list(checkpointDigest), [signature]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
