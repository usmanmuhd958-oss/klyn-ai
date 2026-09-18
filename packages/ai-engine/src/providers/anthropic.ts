import { providerFetch, requireApiKey } from "./http.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderUsage, StreamChunk } from "./types.js";

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic" as const;
  constructor(private readonly baseUrl = "https://api.anthropic.com/v1") {}

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const key = requireApiKey("ANTHROPIC_API_KEY");
    const response = await providerFetch(this.name, `${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: request.model, system: request.system, messages: [{ role: "user", content: request.input }], max_tokens: request.maxOutputTokens ?? 4096, temperature: request.temperature }),
    }, request.signal);
    const body = await response.json() as { id?: string; content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    return { provider: this.name, model: request.model, output: body.content?.filter(x => x.type === "text").map(x => x.text ?? "").join("") ?? "", requestId: body.id, usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const key = requireApiKey("ANTHROPIC_API_KEY");
    const response = await providerFetch(this.name, `${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: request.model, system: request.system, messages: [{ role: "user", content: request.input }], max_tokens: request.maxOutputTokens ?? 4096, temperature: request.temperature, stream: true }),
    }, request.signal);
    if (!response.body) throw new Error("Anthropic returned no stream body");
    yield* parseAnthropicSSE(response.body, request.model);
  }
}

async function* parseAnthropicSSE(body: ReadableStream<Uint8Array>, model: string): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let requestId: string | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5).trim()) as {
            type?: string;
            message?: { id?: string; usage?: { input_tokens?: number; output_tokens?: number } };
            delta?: { type?: string; text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
          };
          requestId = event.message?.id ?? requestId;
          if (event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? inputTokens;
            outputTokens = event.message.usage.output_tokens ?? outputTokens;
          }
          if (event.delta?.usage) {
            inputTokens = event.delta.usage.input_tokens ?? inputTokens;
            outputTokens = event.delta.usage.output_tokens ?? outputTokens;
          }
          const usage: ProviderUsage | undefined =
            inputTokens !== undefined || outputTokens !== undefined
              ? { inputTokens, outputTokens }
              : undefined;
          if (event.delta?.type === "text_delta" && event.delta.text) {
            yield { provider: "anthropic", model, text: event.delta.text, usage, requestId };
          } else if (event.type === "message_start" || event.type === "message_delta") {
            yield { provider: "anthropic", model, text: "", usage, requestId };
          }
          if (event.type === "message_stop") {
            yield { provider: "anthropic", model, text: "", done: true, usage, requestId };
          }
        } catch { /* malformed frames are ignored */ }
      }
    }
  } finally { reader.releaseLock(); }
}
