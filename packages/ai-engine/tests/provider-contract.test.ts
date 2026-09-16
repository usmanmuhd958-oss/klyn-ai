import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AIProviderRouter } from "../src/router.js";
import { UniversalChatAdapter } from "../src/providers/universal.js";
import { ProviderError } from "../src/providers/http.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "../src/providers/types.js";
import { getModelCapability } from "../src/providers/registry.js";

class StubAdapter implements ProviderAdapter {
  constructor(readonly name: ProviderAdapter["name"], private readonly result: ProviderResponse | Error) {}
  async generate(_request: ProviderRequest): Promise<ProviderResponse> {
    void _request;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    if (this.result instanceof Error) throw this.result;
    yield { provider: this.name, model: request.model, text: this.result.output };
    yield { provider: this.name, model: request.model, text: "", done: true };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

test("registry exposes reasoning capability for DeepSeek-R1", () => {
  const capability = getModelCapability("deepseek/deepseek-r1");
  assert.equal(capability?.provider, "deepseek");
  assert.equal(capability?.supportsReasoning, true);
  assert.equal(capability?.supportsStreaming, true);
});

test("universal adapter maps OpenAI-compatible DeepSeek JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ id: "ds-1", choices: [{ message: { content: "answer" } }], usage: { prompt_tokens: 11, completion_tokens: 7 } });
  try {
    const adapter = new UniversalChatAdapter({ name: "deepseek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" });
    process.env.DEEPSEEK_API_KEY = "test-key";
    const response = await adapter.generate({ model: "deepseek-reasoner", input: "test" });
    assert.deepEqual(response, { provider: "deepseek", model: "deepseek-reasoner", output: "answer", requestId: "ds-1", usage: { inputTokens: 11, outputTokens: 7 } });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("universal adapter maps Ollama-compatible streaming SSE", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
  try {
    const adapter = new UniversalChatAdapter({ name: "ollama", baseUrl: "http://127.0.0.1:11434/v1" });
    const chunks = await collect(adapter.stream({ model: "qwen2.5-coder", input: "test" }));
    assert.deepEqual(chunks.map((chunk) => chunk.text), ["hello", " world", ""]);
    assert.equal(chunks.at(-1)?.done, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("router deterministically fails over on retryable Anthropic 429", async () => {
  const events: string[] = [];
  const primary = new StubAdapter("anthropic", new ProviderError("rate limited", "anthropic", true, 429));
  const secondary = new StubAdapter("deepseek", { provider: "deepseek", model: "deepseek-chat", output: "secondary" });
  const router = new AIProviderRouter({
    targets: [
      { provider: "anthropic", model: "claude" },
      { provider: "deepseek", model: "deepseek-chat" },
    ],
    adapters: { anthropic: primary, deepseek: secondary },
    telemetry: { onError: (event) => events.push(`error:${event.provider}`), onSuccess: (event) => events.push(`success:${event.provider}`) },
  });
  const result = await router.generate({ input: "test" });
  assert.equal(result.provider, "deepseek");
  assert.deepEqual(events, ["error:anthropic", "success:deepseek"]);
});

test("router does not fail over on non-retryable provider error", async () => {
  let secondaryCalled = false;
  const primary = new StubAdapter("anthropic", new ProviderError("bad request", "anthropic", false, 400));
  const secondary: ProviderAdapter = new StubAdapter("deepseek", { provider: "deepseek", model: "deepseek-chat", output: "should-not-run" });
  const wrappedSecondary: ProviderAdapter = { ...secondary, async generate(request) { secondaryCalled = true; return secondary.generate(request); }, stream: secondary.stream.bind(secondary) };
  const router = new AIProviderRouter({ targets: [{ provider: "anthropic", model: "claude" }, { provider: "deepseek", model: "deepseek-chat" }], adapters: { anthropic: primary, deepseek: wrappedSecondary } });
  await assert.rejects(() => router.generate({ input: "test" }), /bad request/);
  assert.equal(secondaryCalled, false);
});

test("structured output validates the provider response with Zod", async () => {
  const adapter = new StubAdapter("deepseek", { provider: "deepseek", model: "deepseek-chat", output: '{"ok":true,"score":42}' });
  const router = new AIProviderRouter({ targets: [{ provider: "deepseek", model: "deepseek-chat" }], adapters: { deepseek: adapter } });
  const schema = z.object({ ok: z.boolean(), score: z.number().int().min(0) });
  const result = await router.generateStructured({ input: "test" }, schema);
  assert.deepEqual(result.data, { ok: true, score: 42 });
});

test("structured output rejects schema-invalid JSON", async () => {
  const adapter = new StubAdapter("ollama", { provider: "ollama", model: "qwen2.5-coder", output: '{"ok":"yes"}' });
  const router = new AIProviderRouter({ targets: [{ provider: "ollama", model: "qwen2.5-coder" }], adapters: { ollama: adapter } });
  await assert.rejects(() => router.generateStructured({ input: "test" }, z.object({ ok: z.boolean() })), /Structured output schema validation failed/);
});
