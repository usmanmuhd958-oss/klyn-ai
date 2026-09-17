import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { KernelHealthController, verifyProductionReadiness } from "../src/kernel-health.js";
import { RouterPipeline, type RouterProvider } from "@klyn/ai-engine";

const BASE_HEALTH_LATENCY_BUDGET_MS = 10;
const MOBILE_HEALTH_LATENCY_MULTIPLIER = 4;
const MAX_HEALTH_LATENCY_MULTIPLIER = 20;
const HEALTH_SAMPLE_COUNT = 5;
const isMobileDevelopmentRuntime =
  process.platform === "android" ||
  Boolean(process.env.TERMUX_VERSION) ||
  (process.env.PREFIX?.includes("/com.termux/") ?? false);

function readHealthLatencyMultiplier(raw: string | undefined): number {
  const fallback = isMobileDevelopmentRuntime ? MOBILE_HEALTH_LATENCY_MULTIPLIER : 1;
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_HEALTH_LATENCY_MULTIPLIER);
}

const TEST_HEALTH_LATENCY_MULTIPLIER = readHealthLatencyMultiplier(process.env.TEST_HEALTH_LATENCY_MULTIPLIER);
const HEALTH_LATENCY_BUDGET_MS = BASE_HEALTH_LATENCY_BUDGET_MS * TEST_HEALTH_LATENCY_MULTIPLIER;

test("kernel health returns deterministic schema within the scaled latency budget", () => {
  const controller = new KernelHealthController({
    dag: () => ({ totalTasks: 2, pending: 0, queued: 0, running: 1, succeeded: 1, failed: 0, skipped: 0, blocked: 0, cancelled: 0, rolledBack: 0, dagDurationMs: 3.2 }),
    router: () => ({ attempts: 2, retries: 1, failures: 1, failureRate: 0.5, providerAttempts: { openai: 2 }, providerLatencyMs: { openai: { attempts: 2, totalMs: 8, averageMs: 4 } }, usage: { inputTokens: 10, outputTokens: 20 } }),
    sqlite: KernelHealthController.sqliteSource({
      databasePath: "/tmp/klyn-production-readiness.db",
      queue: () => ({ pending: 1, running: 1, completed: 4, failed: 0, total: 6 }),
      checkpoint: () => ({ busy: 0, logFrames: 12, checkpointedFrames: 12 }),
    }),
    supabase: () => ({ configured: true, connected: true, realtime: "connected", lastEventAt: 1 }),
  });

  const firstSnapshot = controller.collect();
  assert.equal(firstSnapshot.schemaVersion, 1);
  assert.equal(firstSnapshot.system.cpuCount > 0, true);
  assert.equal(firstSnapshot.swarm.totalTasks, 2);
  assert.equal(firstSnapshot.router.usage.outputTokens, 20);
  assert.equal(firstSnapshot.sqlite?.queue.running, 1);
  assert.equal(firstSnapshot.sqlite?.checkpoint?.checkpointedFrames, 12);
  assert.equal(firstSnapshot.supabase.realtime, "connected");

  const latencies: number[] = [];
  for (let index = 0; index < HEALTH_SAMPLE_COUNT; index += 1) {
    const started = performance.now();
    const snapshot = controller.collect();
    latencies.push(performance.now() - started);
    assert.equal(snapshot.schemaVersion, 1);
  }

  const ordered = [...latencies].sort((a, b) => a - b);
  const medianLatency = ordered[Math.floor(ordered.length / 2)] ?? Number.POSITIVE_INFINITY;
  assert.ok(
    medianLatency < HEALTH_LATENCY_BUDGET_MS,
    `median diagnostic collection exceeded ${HEALTH_LATENCY_BUDGET_MS}ms: ${medianLatency.toFixed(3)}ms; samples=${latencies.map((value) => value.toFixed(3)).join(",")}`,
  );
});

test("production readiness verifies environment, pools, and tables", async () => {
  const calls: string[] = [];
  const report = await verifyProductionReadiness({
    env: { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "7860", JWT_SECRET: "x".repeat(32), ADMIN_PASSWORD: "x".repeat(12) },
    verifyConnectionPools: async () => { calls.push("pools"); return true; },
    verifyTables: async () => { calls.push("tables"); return true; },
  });
  assert.equal(report.ready, true);
  assert.deepEqual(calls, ["pools", "tables"]);
  assert.deepEqual(report.missingEnvironment, []);
});

test("router telemetry aggregates tokens, failures, and provider latency", async () => {
  const provider: RouterProvider = {
    provider: "openai",
    model: "telemetry-test",
    adapter: { generate: async () => ({ provider: "openai", model: "telemetry-test", output: "ok", usage: { inputTokens: 7, outputTokens: 11 } }) },
  };
  const router = new RouterPipeline([provider]);
  await router.complete({ input: "health" });
  assert.equal(router.metrics.attempts, 1);
  assert.equal(router.metrics.failures, 0);
  assert.equal(router.metrics.usage.inputTokens, 7);
  assert.equal(router.metrics.usage.outputTokens, 11);
  assert.equal(router.metrics.providerLatencyMs.openai.attempts, 1);
  assert.ok(router.metrics.providerLatencyMs.openai.averageMs >= 0);
});
