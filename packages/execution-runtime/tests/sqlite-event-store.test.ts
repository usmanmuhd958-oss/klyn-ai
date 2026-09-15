import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteAgentEventStore } from "../src/sqlite-event-store.js";

test("SQLite event store persists and replays state", async () => {
  const dir=await mkdtemp(join(tmpdir(),"klyn-p5-")), path=join(dir,"events.sqlite");
  const first=await SqliteAgentEventStore.open(path);
  await first.setValue("tree-1","agent-a","answer",42); await first.append({treeId:"tree-1",agentId:"agent-a",type:"completed",payload:{ok:true}});
  assert.equal((await first.snapshot("tree-1","agent-a")).values.answer,42); await first.close();
  const second=await SqliteAgentEventStore.open(path), state=await second.replay("tree-1","agent-a");
  assert.equal(state.values.answer,42); assert.equal(state.version,1); assert.equal((await second.read("tree-1","agent-a"))[1].type,"completed"); await second.close(); await rm(dir,{recursive:true,force:true});
});

test("concurrent appends receive unique ordered sequences", async () => {
  const dir=await mkdtemp(join(tmpdir(),"klyn-p5-lock-")),store=await SqliteAgentEventStore.open(join(dir,"events.sqlite"));
  await Promise.all(Array.from({length:20},(_,i)=>store.append({treeId:"tree",agentId:"agent",type:"progress",payload:i})));
  assert.deepEqual((await store.read("tree","agent")).map(e=>e.sequence),Array.from({length:20},(_,i)=>i+1)); await store.close(); await rm(dir,{recursive:true,force:true});
});
