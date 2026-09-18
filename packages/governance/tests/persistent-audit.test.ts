import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuditLedger,
  FileAuditStorageAdapter,
  SqliteAuditStorageAdapter,
} from "../src/index.js";

function appendSample(ledger: AuditLedger): void {
  ledger.append({
    kind: "authorization",
    requestId: "req-1",
    principalId: "principal-1",
    toolName: "builder",
    operation: "execute",
    decision: "allowed",
    reason: "granted",
    scopeId: "scope-1",
    timestampEpochMs: 1,
  });
  ledger.append({
    kind: "completion-gate",
    objectiveId: "objective-1",
    decision: "blocked",
    missingInvariantIds: ["invariant-1"],
    acceptedEvidenceIds: [],
    timestampEpochMs: 2,
  });
}

test("file adapter rehydrates a hash-chained audit ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyn-audit-"));
  try {
    const path = join(dir, "audit.jsonl");
    const first = new AuditLedger(new FileAuditStorageAdapter(path));
    appendSample(first);
    const expectedHead = first.headHash();
    first.close();

    const reopened = new AuditLedger(new FileAuditStorageAdapter(path));
    assert.equal(reopened.verify(), true);
    assert.equal(reopened.length(), 2);
    assert.equal(reopened.headHash(), expectedHead);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite adapter is append-only and rehydrates the same chain", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyn-audit-sqlite-"));
  try {
    const path = join(dir, "audit.db");
    const adapter = new SqliteAuditStorageAdapter(path);
    const ledger = new AuditLedger(adapter);
    appendSample(ledger);

    assert.equal(ledger.verify(), true);
    const records = ledger.records();
    assert.equal(records.length, 2);

    assert.throws(
      () => adapter.append(records[0]!),
      /sequence conflict|previous-hash conflict/,
    );

    ledger.close();

    const reopened = new AuditLedger(new SqliteAuditStorageAdapter(path));
    assert.equal(reopened.verify(), true);
    assert.equal(reopened.headHash(), records[1]!.hash);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
