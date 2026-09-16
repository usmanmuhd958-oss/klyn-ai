import { buildMessages, jsonHeaders, providerFetch, requireApiKey } from "./http.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk } from "./types.js";

function textFromResponse(body: unknown): string {
  const value = body as { choices?: Array<{ message?: { content?: string | null } }> };
  return value.choices?.[0]?.message?.content ?? "";
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai" as const;
  constructor(private readonly baseUrl = "https://api.openai.com/v1") {}

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const key = requireApiKey("OPENAI_API_KEY");
    const response = await providerFetch(this.name, `${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: jsonHeaders(key),
      body: JSON.stringify({
        model: request.model,
        messages: buildMessages(request),
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      }),
    }, request.signal);
    const body = await response.json();
    const raw = body as { id?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      provider: this.name,
      model: request.model,
      output: textFromResponse(body),
      requestId: raw.id,
      usage: { inputTokens: raw.usage?.prompt_tokens, outputTokens: raw.usage?.completion_tokens },
    };
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const key = requireApiKey("OPENAI_API_KEY");
    const response = await providerFetch(this.name, `${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: jsonHeaders(key),
      body: JSON.stringify({
        model: request.model,
        messages: buildMessages(request),
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: true,
      }),
    }, request.signal);
    if (!response.body) throw new Error("OpenAI returned no stream body");
    yield* parseSSE(response.body, this.name, request.model);
  }
}

async function* parseSSE(body: ReadableStream<Uint8Array>, provider: "openai", model: string): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { yield { provider, model, text: "", done: true }; return; }
        try {
          const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const text = json.choices?.[0]?.delta?.content ?? "";
          if (text) yield { provider, model, text };
        } catch { /* ignore incomplete/non-JSON SSE frames */ }
      }
    }
  } finally { reader.releaseLock(); }
}
