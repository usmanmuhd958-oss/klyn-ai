import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ProviderError } from "../src/providers/http.js";
import { RouterPipeline } from "../src/provider-router.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "../src/providers/types.js";

class Stub implements ProviderAdapter {
  constructor(readonly name: ProviderAdapter["name"], private readonly run: (r: ProviderRequest) => ProviderResponse | Error) {}
  async generate(r: ProviderRequest): Promise<ProviderResponse> { const v = this.run(r); if (v instanceof Error) throw v; return v; }
  async *stream(_r: ProviderRequest): AsyncIterable<StreamChunk> { yield* []; }
}
const response = (provider: ProviderAdapter["name"], model: string, output: string): ProviderResponse => ({ provider, model, output, usage: { inputTokens: 10, outputTokens: 5 } });

test("fails over after exactly three retries on 429", async () => {
  let calls = 0;
  const primary = new Stub("openai", () => { calls++; return new ProviderError("rate limit", "openai", true, 429); });
  const secondary = new Stub("anthropic", () => response("anthropic", "claude", "ok"));
  const router = new RouterPipeline([{ provider: "openai", model: "gpt", adapter: primary }, { provider: "anthropic", model: "claude", adapter: secondary }], { maxRetriesPerProvider: 3, baseDelayMs: 0, jitter: 0 });
  const result = await router.complete({ input: "x" });
  assert.equal(result.provider, "anthropic"); assert.equal(calls, 4); assert.equal(router.metrics.retries, 3);
});

test("fails over on 5xx without leaking rejection", async () => {
  const primary = new Stub("openai", () => new ProviderError("unavailable", "openai", true, 503));
  const secondary = new Stub("deepseek", () => response("deepseek", "deepseek-chat", "ok"));
  const router = new RouterPipeline([{ provider: "openai", model: "gpt", adapter: primary }, { provider: "deepseek", model: "deepseek-chat", adapter: secondary }], { maxRetriesPerProvider: 1, baseDelayMs: 0, jitter: 0 });
  assert.equal((await router.complete({ input: "x" })).provider, "deepseek");
});

test("does not retry non-transient errors", async () => {
  let secondary = false;
  const primary = new Stub("openai", () => new ProviderError("bad request", "openai", false, 400));
  const fallback = new Stub("anthropic", () => { secondary = true; return response("anthropic", "claude", "no"); });
  const router = new RouterPipeline([{ provider: "openai", model: "gpt", adapter: primary }, { provider: "anthropic", model: "claude", adapter: fallback }], { baseDelayMs: 0, jitter: 0 });
  await assert.rejects(() => router.complete({ input: "x" }), /bad request/); assert.equal(secondary, false);
});

test("validates structured output and records token usage", async () => {
  const adapter = new Stub("gemini", () => response("gemini", "gemini-pro", '{"ok":true}'));
  const router = new RouterPipeline([{ provider: "gemini", model: "gemini-pro", adapter }]);
  const result = await router.complete({ input: "x", responseFormat: "json" }, z.object({ ok: z.boolean() }));
  assert.equal(result.output, '{"ok":true}'); assert.deepEqual(router.metrics.usage, { inputTokens: 10, outputTokens: 5 });
});

test("rejects invalid structured JSON", async () => {
  const adapter = new Stub("openrouter", () => response("openrouter", "model", '{"ok":"yes"}'));
  const router = new RouterPipeline([{ provider: "openrouter", model: "model", adapter }]);
  await assert.rejects(() => router.complete({ input: "x" }, z.object({ ok: z.boolean() })), /Invalid input|Expected boolean/);
});
