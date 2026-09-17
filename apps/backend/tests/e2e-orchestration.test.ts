import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { RouterPipeline, type RouterProvider } from "@klyn/ai-engine";
import { SqliteAgentEventStore } from "@klyn/execution-runtime";
import { SwarmDagOrchestrator, type AgentTask } from "../../../packages/cognitive-engine/src/swarm/DagOrchestrator.js";
import { SupabaseExecutionLedgerSync, type RealtimePayload, type SupabaseLedgerClient, type SupabaseTableQuery } from "../src/supabase/execution-ledger-sync.js";
import { closeJsonRpcAgentIpcServer, JsonRpcAgentIpcTransport, startJsonRpcAgentIpcServer, type AgentSandboxService } from "../src/ipc/json-rpc-transport.js";

const root = await mkdtemp(join(tmpdir(), "klyn-p66-"));

const BASE_E2E_LATENCY_BUDGET_MS = 200;
const MOBILE_LATENCY_MULTIPLIER = 4;
const MAX_LATENCY_MULTIPLIER = 20;
const isMobileDevelopmentRuntime =
  process.platform === "android" ||
  Boolean(process.env.TERMUX_VERSION) ||
  (process.env.PREFIX?.includes("/com.termux/") ?? false);

function readLatencyMultiplier(raw: string | undefined): number {
  const fallback = isMobileDevelopmentRuntime ? MOBILE_LATENCY_MULTIPLIER : 1;
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_LATENCY_MULTIPLIER);
}

const TEST_LATENCY_MULTIPLIER = readLatencyMultiplier(process.env.TEST_LATENCY_MULTIPLIER);
const E2E_LATENCY_BUDGET_MS = BASE_E2E_LATENCY_BUDGET_MS * TEST_LATENCY_MULTIPLIER;

class MemoryTable implements SupabaseTableQuery {
  readonly upserts: Array<{ values: Record<string, unknown> | Record<string, unknown>[]; options?: { onConflict?: string } }> = [];
  readonly inserts: Array<Record<string, unknown> | Record<string, unknown>[]> = [];
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }): Promise<{ data: null; error: null }> { this.upserts.push({ values, options }); return Promise.resolve({ data: null, error: null }); }
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Promise<{ data: null; error: null }> { this.inserts.push(values); return Promise.resolve({ data: null, error: null }); }
}

class MemorySupabase implements SupabaseLedgerClient {
  readonly tables = new Map<string, MemoryTable>();
  readonly subscriptions = new Map<string, (payload: RealtimePayload) => void>();
  from(table: string): SupabaseTableQuery {
    let value = this.tables.get(table);
    if (!value) { value = new MemoryTable(); this.tables.set(table, value); }
    return value;
  }
  channel(name: string) {
    const channel = {
      on: (_event: "postgres_changes", _filter: Record<string, unknown>, callback: (payload: RealtimePayload) => void) => { this.subscriptions.set(name, callback); return channel; },
      subscribe: () => channel,
      unsubscribe: async () => { this.subscriptions.delete(name); },
    };
    return channel;
  }
}

const makeProvider = (provider: "openai" | "anthropic", output: string): RouterProvider => ({
  provider,
  model: `${provider}-test`,
  adapter: {
    name: provider,
    async generate() { return { provider, model: `${provider}-test`, output, usage: { inputTokens: 7, outputTokens: 5 }, requestId: `${provider}-request` }; },
    async *stream() { yield { provider, model: `${provider}-test`, text: output, done: true }; },
  },
});

describe("Klyn Phase 6.6 E2E orchestration", () => {
  let store: SqliteAgentEventStore;
  before(async () => { store = await SqliteAgentEventStore.open(join(root, "execution.sqlite")); });
  after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });

  it("connects AI routing -> deterministic DAG -> durable queue -> JSON-RPC -> Supabase ledger", async () => {
    const started = performance.now();
    const executionId = "e2e-execution-001";
    const ledgerClient = new MemorySupabase();
    const ledger = new SupabaseExecutionLedgerSync(ledgerClient);
    const router = new RouterPipeline([makeProvider("openai", '{"plan":"execute"}')], { baseDelayMs: 0, jitter: 0 });
    const completion = await router.complete({ input: "plan execution", responseFormat: "json" }, undefined);
    assert.equal(completion.provider, "openai");
    assert.deepEqual(router.metrics.usage, { inputTokens: 7, outputTokens: 5 });
    await ledger.publish({ type: "provider.telemetry", executionId, provider: completion.provider, model: completion.model, attempt: 1, status: "success", inputTokens: 7, outputTokens: 5, totalTokens: 12 });

    const dag = new SwarmDagOrchestrator();
    const tasks: AgentTask[] = [
      { id: "plan", agentId: "planner", input: completion.output, run: async () => ({ planned: true }) },
      { id: "execute", agentId: "executor", input: "run", dependsOn: ["plan"], run: async () => ({ executed: true }) },
    ];
    dag.addTasks(tasks);
    assert.deepEqual(dag.topologicalSort(), [["plan"], ["execute"]]);
    await ledger.publish({ type: "execution.state", executionId, dagId: "dag-001", status: "pending" });
    const durable = await store.enqueueTask({ id: "durable-e2e-001", idempotencyKey: "e2e-idempotency-001", payload: { executionId, dagId: "dag-001" } });
    const claimed = await store.claimPendingTask("worker-a", 30_000);
    assert.equal(claimed?.id, durable.id);
    assert.equal(claimed?.status, "RUNNING");

    const service: AgentSandboxService = { async execute(request) { return { executionId: request.executionId, result: { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 } }; } };
    const server = await startJsonRpcAgentIpcServer(service, { host: "127.0.0.1", port: 0 });
    const address = server.address();
    assert.equal(typeof address, "object");
    const transport = new JsonRpcAgentIpcTransport("127.0.0.1", (address as { port: number }).port);
    const rpcResult = await transport.call({ executionId, treeId: "dag-001", agentId: "executor", request: { language: "javascript", source: "console.log('ok')" } });
    assert.equal(rpcResult.executionId, executionId);
    transport.close();
    await closeJsonRpcAgentIpcServer(server);

    const dagResult = await dag.execute({ maxConcurrency: 2, failFast: true });
    assert.equal(dagResult.statuses.execute, "succeeded");
    await store.completeTask(durable.id);
    await ledger.publish({ type: "dag.state", executionId, dagId: "dag-001", nodeId: "execute", state: "succeeded", attempt: 1, result: { executed: true } });
    await ledger.publish({ type: "agent.log", executionId, agentId: "executor", level: "info", event: "completed", sequence: 1 });
    await ledger.publish({ type: "execution.state", executionId, dagId: "dag-001", status: "succeeded", completedAt: new Date().toISOString() });
    assert.equal(ledgerClient.tables.get("executions")!.upserts.length, 2);
    assert.equal(ledgerClient.tables.get("dag_states")!.upserts.length, 1);
    assert.equal(ledgerClient.tables.get("provider_telemetry")!.inserts.length, 1);
    assert.equal((await store.getTask(durable.id))?.status, "COMPLETED");
    const elapsed = performance.now() - started;
    assert.ok(elapsed < E2E_LATENCY_BUDGET_MS, `full E2E flow exceeded ${E2E_LATENCY_BUDGET_MS}ms: ${elapsed.toFixed(3)}ms`);
  });

  it("recovers a crashed RUNNING worker from SQLite WAL deterministically", async () => {
    const crashPath = join(root, "crash-recovery.sqlite");
    const first = await SqliteAgentEventStore.open(crashPath);
    const task = await first.enqueueTask({ id: "crash-task", idempotencyKey: "crash-idempotency", payload: { value: 42 } });
    const running = await first.claimPendingTask("worker-crashed");
    assert.equal(running?.status, "RUNNING");
    await first.close();
    const recovered = await SqliteAgentEventStore.open(crashPath);
    const pending = await recovered.getTask(task.id);
    assert.equal(pending?.status, "PENDING");
    assert.equal(pending?.recoveryCount, 1);
    const retry = await recovered.claimPendingTask("worker-recovered");
    assert.equal(retry?.status, "RUNNING");
    assert.equal(retry?.attempts, 2);
    await recovered.completeTask(task.id);
    assert.equal((await recovered.getTask(task.id))?.status, "COMPLETED");
    await recovered.close();
  });

  it("survives concurrent durable work without unhandled promise rejections or listener growth", async () => {
    const beforeUnhandled = process.listenerCount("unhandledRejection");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const started = performance.now();
      const jobs = Array.from({ length: 64 }, (_, index) => store.enqueueTask({ idempotencyKey: `stress-${index}`, payload: { index } }));
      const tasks = await Promise.all(jobs);
      const claimed = await Promise.all(tasks.map((_, index) => store.claimPendingTask(`stress-worker-${index}`)));
      assert.equal(claimed.filter(Boolean).length, 64);
      await Promise.all(claimed.map((task) => store.completeTask(task!.id)));
      const completed = await Promise.all(tasks.map((task) => store.getTask(task.id)));
      assert.ok(completed.every((task) => task?.status === "COMPLETED"));
      assert.deepEqual([...new Set(completed.map((task) => task?.recoveryCount))], [0]);
      assert.deepEqual(unhandled, []);
      assert.equal(process.listenerCount("unhandledRejection"), beforeUnhandled + 1);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < E2E_LATENCY_BUDGET_MS, `stress harness exceeded ${E2E_LATENCY_BUDGET_MS}ms: ${elapsed.toFixed(3)}ms`);
    } finally { process.off("unhandledRejection", onUnhandled); }
    assert.equal(process.listenerCount("unhandledRejection"), beforeUnhandled);
  });
});
