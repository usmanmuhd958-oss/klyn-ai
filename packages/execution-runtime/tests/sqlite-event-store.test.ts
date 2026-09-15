import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteAgentEventStore } from "../src/sqlite-event-store.js";

test("SQLite event store persists and replays state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p5-"));
  const path = join(dir, "events.sqlite");
  try {
    const first = await SqliteAgentEventStore.open(path);
    try {
      await first.setValue("tree-1", "agent-a", "answer", 42);
      await first.append({ treeId: "tree-1", agentId: "agent-a", type: "completed", payload: { ok: true } });
      assert.equal((await first.snapshot("tree-1", "agent-a")).values.answer, 42);
    } finally {
      await first.close();
    }

    const second = await SqliteAgentEventStore.open(path);
    try {
      const state = await second.replay("tree-1", "agent-a");
      assert.equal(state.values.answer, 42);
      assert.equal(state.version, 1);
      assert.equal((await second.read("tree-1", "agent-a"))[1].type, "completed");
    } finally {
      await second.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent appends receive unique ordered sequences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "klyn-p5-lock-"));
  const store = await SqliteAgentEventStore.open(join(dir, "events.sqlite"));
  try {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append({ treeId: "tree", agentId: "agent", type: "progress", payload: i })));
    assert.deepEqual((await store.read("tree", "agent")).map((event) => event.sequence), Array.from({ length: 20 }, (_, i) => i + 1));
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
