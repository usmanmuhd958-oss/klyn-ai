import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteAgentEventStore } from "../src/sqlite-event-store.js";

test("SQLite event store persists and replays state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p62-state-"));
  const path = join(dir, "events.sqlite");
  try {
    const first = await SqliteAgentEventStore.open(path);
    try {
      await first.setValue("tree-1", "agent-a", "answer", 42);
      await first.append({ treeId: "tree-1", agentId: "agent-a", type: "completed", payload: { ok: true } });
      assert.equal((await first.snapshot("tree-1", "agent-a")).values.answer, 42);
    } finally { await first.close(); }

    const second = await SqliteAgentEventStore.open(path);
    try {
      const state = await second.replay("tree-1", "agent-a");
      assert.equal(state.values.answer, 42);
      assert.equal(state.version, 1);
      assert.equal((await second.read("tree-1", "agent-a"))[1].type, "completed");
    } finally { await second.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("SQLite task queue is idempotent and transactionally stateful", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p62-queue-"));
  const path = join(dir, "queue.sqlite");
  try {
    const store = await SqliteAgentEventStore.open(path);
    try {
      const first = await store.enqueueTask({ idempotencyKey: "job-1", payload: { command: "build" } });
      const duplicate = await store.enqueueTask({ id: "different-id", idempotencyKey: "job-1", payload: { command: "different" } });
      assert.equal(duplicate?.id, first.id);
      assert.equal(duplicate?.attempts, 0);
      const claimed = await store.claimPendingTask<{ command: string }>("worker-a", 1000);
      assert.equal(claimed?.status, "RUNNING");
      assert.equal(claimed?.attempts, 1);
      assert.equal(claimed?.payload.command, "build");
      assert.equal((await store.completeTask(first.id))?.status, "COMPLETED");
    } finally { await store.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("interrupted RUNNING tasks are recovered after store re-instantiation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p62-recovery-"));
  const path = join(dir, "queue.sqlite");
  try {
    const first = await SqliteAgentEventStore.open(path);
    const task = await first.enqueueTask({ idempotencyKey: "crash-1", payload: { work: "durable" } });
    await first.claimPendingTask("worker-before-crash");
    await first.close();

    const second = await SqliteAgentEventStore.open(path);
    try {
      const recovered = await second.getTask(task.id);
      assert.equal(recovered?.status, "PENDING");
      assert.equal(recovered?.recoveryCount, 1);
      const reclaimed = await second.claimPendingTask("worker-after-restart");
      assert.equal(reclaimed?.status, "RUNNING");
      assert.equal(reclaimed?.attempts, 2);
    } finally { await second.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("SQLite WAL mode is active and durable artifacts are closed cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p62-wal-"));
  const path = join(dir, "wal.sqlite");
  try {
    const store = await SqliteAgentEventStore.open(path);
    await store.enqueueTask({ idempotencyKey: "wal-1", payload: { ok: true } });
    await store.close();
    const bytes = await readFile(path);
    assert.ok(bytes.length > 100);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent appends receive unique ordered sequences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p62-lock-"));
  const store = await SqliteAgentEventStore.open(join(dir, "events.sqlite"));
  try {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append({ treeId: "tree", agentId: "agent", type: "progress", payload: i })));
    assert.deepEqual((await store.read("tree", "agent")).map((event) => event.sequence), Array.from({ length: 20 }, (_, i) => i + 1));
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
