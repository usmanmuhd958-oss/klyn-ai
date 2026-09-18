import { ProviderError, providerFetch } from "./http.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk, ProviderUsage } from "./types.js";

interface OllamaResponse {
  model?: string;
  message?: { content?: string | null };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

function normalizedUsage(data: OllamaResponse): ProviderUsage | undefined {
  if (data.prompt_eval_count === undefined && data.eval_count === undefined) return undefined;
  return { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count };
}

export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama" as const;

  constructor(private readonly baseUrl = "http://127.0.0.1:11434") {}

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const body = {
      model: request.model,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        { role: "user", content: request.input },
      ],
      stream: false,
      ...(request.maxOutputTokens !== undefined || request.temperature !== undefined
        ? {
            options: {
              ...(request.maxOutputTokens !== undefined ? { num_predict: request.maxOutputTokens } : {}),
              ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            },
          }
        : {}),
      ...(request.responseFormat === "json" ? { format: "json" } : {}),
    };
    const response = await providerFetch(this.name, `${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, request.signal);
    const data = await response.json() as OllamaResponse;
    return {
      provider: this.name,
      model: request.model,
      output: data.message?.content ?? "",
      usage: normalizedUsage(data),
    };
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const response = await providerFetch(this.name, `${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: request.input },
        ],
        stream: true,
        ...(request.maxOutputTokens !== undefined || request.temperature !== undefined
          ? {
              options: {
                ...(request.maxOutputTokens !== undefined ? { num_predict: request.maxOutputTokens } : {}),
                ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
              },
            }
          : {}),
        ...(request.responseFormat === "json" ? { format: "json" } : {}),
      }),
    }, request.signal);
    if (!response.body) throw new ProviderError("Ollama returned no streaming body", this.name, true, response.status);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const event = JSON.parse(trimmed) as OllamaResponse;
          const text = event.message?.content ?? "";
          const usage = normalizedUsage(event);
          if (text || usage) yield { provider: this.name, model: request.model, text, usage };
          if (event.done) {
            yield { provider: this.name, model: request.model, text: "", done: true, usage };
            return;
          }
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new ProviderError("Ollama returned malformed streaming JSON", this.name, false);
      throw error;
    } finally {
      reader.releaseLock();
    }
    yield { provider: this.name, model: request.model, text: "", done: true };
  }
}
