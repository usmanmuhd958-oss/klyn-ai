import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AiEngine,
  AiEngineError,
  ContextSelector,
  TokenCostMeter,
  createBuiltinProvider,
  type ProviderAdapter,
  type ProviderResponse,
  type StreamChunk,
} from "../src/index.js";

function fakeAdapter(
  provider: "openai" | "anthropic" | "gemini" | "deepseek" | "vllm" | "ollama",
  model: string,
  generate: (input: string) => Promise<ProviderResponse>,
): ProviderAdapter {
  return {
    name: provider,
    generate(request) {
      return generate(request.input);
    },
    async *stream(request): AsyncIterable<StreamChunk> {
      yield { provider, model: request.model, text: request.input };
      yield { provider, model: request.model, text: "", done: true };
    },
  };
}

function provider(
  id: string,
  providerName: "openai" | "anthropic" | "gemini" | "deepseek" | "vllm" | "ollama",
  model: string,
  adapter: ProviderAdapter,
  overrides: Partial<Parameters<typeof createBuiltinProvider>[0]> = {},
) {
  return {
    id,
    definition: {
      provider: providerName,
      model,
      contextWindowTokens: overrides.contextWindowTokens ?? 8192,
      capabilities: new Set(overrides.capabilities ?? ["structured-output"]),
      pricing: {
        inputMicrousdPer1kTokens: overrides.inputMicrousdPer1kTokens ?? 1000,
        outputMicrousdPer1kTokens: overrides.outputMicrousdPer1kTokens ?? 2000,
      },
      evaluationScore: overrides.tags?.includes("verified") ? 0.95 : 0.5,
      tags: overrides.tags,
    },
    adapter,
  };
}

test("phase 2 routes deterministically and fails over after a provider failure", async () => {
  const primary = provider(
    "p1",
    "openai",
    "model-a",
    fakeAdapter("openai", "model-a", async () => {
      throw new Error("primary unavailable");
    }),
    { evaluationScore: undefined },
  );
  const backup = provider(
    "p2",
    "anthropic",
    "model-b",
    fakeAdapter("anthropic", "model-b", async (input) => ({
      provider: "anthropic",
      model: "model-b",
      output: `ok:${input}`,
      usage: { inputTokens: 100, outputTokens: 25 },
    })),
  );

  const engine = new AiEngine([primary, backup], {
    routing: { objective: "cost", maxAttempts: 2, maxOutputTokens: 100 },
  });
  const result = await engine.complete({ input: "hello" });

  assert.equal(result.providerId, "p2");
  assert.equal(result.attempts, 2);
  assert.equal(result.fallbackCount, 1);
  assert.equal(result.costMicrousd, 150);
  assert.equal(engine.health.snapshot("p1").totalFailures, 1);
  assert.equal(engine.health.snapshot("p2").totalSuccesses, 1);
});

test("phase 2 circuit state prevents repeated calls to an unavailable provider", async () => {
  let calls = 0;
  const primary = provider(
    "p1",
    "openai",
    "model-a",
    fakeAdapter("openai", "model-a", async () => {
      calls += 1;
      throw Object.assign(new Error("server failure"), { retryable: true });
    }),
  );
  const backup = provider(
    "p2",
    "ollama",
    "model-b",
    fakeAdapter("ollama", "model-b", async () => ({
      provider: "ollama",
      model: "model-b",
      output: "local",
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  );

  const engine = new AiEngine([primary, backup], {
    health: { failureThreshold: 1, recoveryCooldownMs: 60_000 },
    routing: { maxAttempts: 2 },
  });

  await engine.complete({ input: "one" });
  await engine.complete({ input: "two" });

  assert.equal(calls, 1);
  assert.equal(engine.health.snapshot("p1").state, "unavailable");
});

test("phase 2 context selection preserves required items and is deterministic", () => {
  const selector = new ContextSelector({ maxTokens: 20, reserveTokens: 4, maxItems: 4 });
  const result = selector.select([
    { id: "z", content: "z".repeat(32), priority: "normal", score: 10 },
    { id: "a", content: "a", priority: "required", score: 0 },
    { id: "b", content: "b", priority: "high", score: 5 },
  ]);

  assert.deepEqual(result.selected.map((item) => item.id), ["a", "b"]);
  assert.equal(result.omitted.length, 1);
  assert.equal(result.omitted[0]?.id, "z");
});

test("phase 2 token metering refuses to fabricate incomplete usage", () => {
  const model = provider(
    "local",
    "ollama",
    "qwen",
    fakeAdapter("ollama", "qwen", async () => ({ provider: "ollama", model: "qwen", output: "ok" })),
    { inputMicrousdPer1kTokens: 3000, outputMicrousdPer1kTokens: 6000 },
  );
  const meter = new TokenCostMeter();
  const partial = meter.record(model, 10, undefined);
  const complete = meter.record(model, 100, 50);

  assert.equal(partial.status, "partial");
  assert.equal(partial.costMicrousd, undefined);
  assert.equal(complete.status, "complete");
  assert.equal(complete.costMicrousd, 600);
  assert.deepEqual(meter.totals(), { inputTokens: 110, outputTokens: 50, costMicrousd: 600 });
});

test("phase 2 rejects untrusted provider endpoints", () => {
  assert.doesNotThrow(() => createBuiltinProvider({
    id: "deepseek-prod",
    provider: "deepseek",
    model: "deepseek-model",
    contextWindowTokens: 128_000,
  }));
  assert.doesNotThrow(() => createBuiltinProvider({
    id: "vllm-local",
    provider: "vllm",
    model: "local-model",
    contextWindowTokens: 32_000,
    baseUrl: "http://127.0.0.1:8000/v1",
  }));
  assert.doesNotThrow(() => createBuiltinProvider({
    id: "ollama-local",
    provider: "ollama",
    model: "qwen",
    contextWindowTokens: 32_000,
    baseUrl: "http://localhost:11434",
  }));
  assert.throws(() => createBuiltinProvider({
    id: "evil-vllm",
    provider: "vllm",
    model: "model",
    contextWindowTokens: 4096,
    baseUrl: "http://10.0.0.4:8000/v1",
  }), /HTTPS|allowlisted/);
  assert.throws(() => createBuiltinProvider({
    id: "evil-openai",
    provider: "openai",
    model: "model",
    contextWindowTokens: 4096,
    baseUrl: "https://evil.example/v1",
  }), /allowlisted/);
});

test("phase 2 enforces structured-output validity and falls back", async () => {
  const invalid = provider(
    "invalid",
    "gemini",
    "json-a",
    fakeAdapter("gemini", "json-a", async () => ({ provider: "gemini", model: "json-a", output: "not json", usage: { inputTokens: 2, outputTokens: 2 } })),
  );
  const valid = provider(
    "valid",
    "openai",
    "json-b",
    fakeAdapter("openai", "json-b", async () => ({ provider: "openai", model: "json-b", output: "{\"ok\":true}", usage: { inputTokens: 2, outputTokens: 3 } })),
  );
  const engine = new AiEngine([invalid, valid], { routing: { maxAttempts: 2 } });
  const result = await engine.complete({ input: "return json", responseFormat: "json" });

  assert.equal(result.providerId, "valid");
  assert.equal(result.fallbackCount, 1);
});

test("phase 2 maps aborted caller signals to a typed contract", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));
  const engine = new AiEngine([
    provider("p", "ollama", "model", fakeAdapter("ollama", "model", async () => ({ provider: "ollama", model: "model", output: "never" }))),
  ]);

  await assert.rejects(
    engine.complete({ input: "hello", signal: controller.signal }),
    (error: unknown) => error instanceof AiEngineError && error.code === "ABORTED",
  );
});
