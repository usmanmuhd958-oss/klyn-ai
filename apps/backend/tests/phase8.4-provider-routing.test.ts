import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FallbackRouter, ProviderCircuitBreaker, ProviderError, TokenTelemetryStreamer, type ProviderAdapter, type StreamChunk } from "../../../packages/ai-engine/src/index.ts";

function adapter(name: "anthropic" | "openai", failures = 0): ProviderAdapter {
  let attempts = 0;
  return {
    name,
    async generate(request) {
      attempts++;
      if (attempts <= failures) throw new ProviderError(`${name} transient failure`, name, true, 503);
      return { provider: name, model: request.model, output: `${name}:ok`, usage: { inputTokens: 4, outputTokens: 3 } };
    },
    async *stream(request): AsyncIterable<StreamChunk> {
      yield { provider: name, model: request.model, text: "one two" };
      yield { provider: name, model: request.model, text: "three", done: true };
    },
  };
}

test("phase 8.4 fails over from a transient primary provider to the backup", async () => {
  const router = new FallbackRouter([
    { provider: "anthropic", model: "requested", adapter: adapter("anthropic", 1) },
    { provider: "openai", model: "requested", adapter: adapter("openai") },
  ], new ProviderCircuitBreaker({ failureThreshold: 1 }), { maxRetriesPerProvider: 0 });
  const response = await router.complete({ model: "requested", input: "hello" });
  assert.equal(response.provider, "openai");
  assert.equal(router.telemetry.successes, 1);
  assert.equal(router.telemetry.fallbackCount, 1);
  assert.equal(router.telemetry.providerAttempts.anthropic, 1);
  assert.equal(router.telemetry.providerAttempts.openai, 1);
  assert.equal(router.circuitBreaker.snapshot().anthropic?.open, true);
});

test("phase 8.4 circuit breaker prevents repeated calls to an unhealthy primary", async () => {
  let primaryCalls = 0;
  const primary = adapter("anthropic", 10);
  const originalGenerate = primary.generate;
  primary.generate = async (request) => { primaryCalls++; return originalGenerate(request); };
  const backup = adapter("openai");
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 1 });
  const router = new FallbackRouter([
    { provider: "anthropic", model: "m", adapter: primary },
    { provider: "openai", model: "m", adapter: backup },
  ], breaker, { maxRetriesPerProvider: 0 });
  await router.complete({ model: "m", input: "first" });
  await router.complete({ model: "m", input: "second" });
  assert.equal(primaryCalls, 1);
  assert.equal(router.telemetry.providerAttempts.openai, 2);
  assert.equal(breaker.snapshot().anthropic?.open, true);
});

test("phase 8.4 streaming telemetry counts injected tokenizer output and latency", async () => {
  const streamer = new TokenTelemetryStreamer((text) => text.trim() ? text.trim().split(/\s+/).length : 0);
  const chunks: string[] = [];
  for await (const chunk of streamer.wrap(adapter("openai").stream({ model: "m", input: "x" }), { requestId: "r1", provider: "openai", model: "m" }, 4)) chunks.push(chunk.text);
  const [record] = streamer.snapshot();
  assert.deepEqual(chunks, ["one two", "three"]);
  assert.equal(record.inputTokens, 4);
  assert.equal(record.outputTokens, 3);
  assert.equal(record.chunks, 2);
  assert.equal(typeof record.latencyMs, "number");
  assert.equal(typeof record.timeToFirstTokenMs, "number");
});
