import { ProviderError, buildMessages, providerFetch, requireApiKey } from "./http.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderName, StreamChunk } from "./types.js";

export interface UniversalProviderConfig { name: ProviderName; baseUrl: string; apiKeyEnv?: string; defaultHeaders?: Record<string, string>; extraBody?: Record<string, unknown>; }

export class UniversalChatAdapter implements ProviderAdapter {
  readonly name: ProviderName;
  private readonly config: UniversalProviderConfig;
  constructor(config: UniversalProviderConfig) { this.name = config.name; this.config = { ...config, baseUrl: config.baseUrl.replace(/\/$/, "") }; }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const body = { model: request.model, messages: buildMessages(request), ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}), ...this.config.extraBody };
    const response = await providerFetch(this.name, `${this.config.baseUrl}/chat/completions`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }, request.signal);
    const data = await response.json() as { id?: string; choices?: Array<{ message?: { content?: string | null }; text?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { provider: this.name, model: request.model, output: data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "", requestId: data.id, usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens } };
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const body = { model: request.model, messages: buildMessages(request), stream: true, stream_options: { include_usage: true }, ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}), ...this.config.extraBody };
    const response = await providerFetch(this.name, `${this.config.baseUrl}/chat/completions`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) }, request.signal);
    if (!response.body) throw new ProviderError("Provider returned no streaming body", this.name, true, response.status);
    yield* parseOpenAIStream(response.body, this.name, request.model);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json", ...this.config.defaultHeaders };
    if (this.config.apiKeyEnv) headers.authorization = `Bearer ${requireApiKey(this.config.apiKeyEnv)}`;
    return headers;
  }
}

async function* parseOpenAIStream(body: ReadableStream<Uint8Array>, provider: ProviderName, model: string): AsyncIterable<StreamChunk> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
      for (const event of events) {
        const line = event.split("\n").find((item) => item.startsWith("data:")); if (!line) continue;
        const payload = line.slice(5).trim(); if (payload === "[DONE]") { yield { provider, model, text: "", done: true }; return; }
        try { const data = JSON.parse(payload) as {
          id?: string;
          choices?: Array<{ delta?: { content?: string | null } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const usage = data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : undefined;
        const text = data.choices?.[0]?.delta?.content ?? "";
        if (text || usage) yield { provider, model, text, usage, requestId: data.id }; } catch { /* ignore non-JSON keep-alive frames */ }
      }
    }
  } finally { reader.releaseLock(); }
  yield { provider, model, text: "", done: true };
}

export function createUniversalAdapter(config: UniversalProviderConfig): UniversalChatAdapter { return new UniversalChatAdapter(config); }
