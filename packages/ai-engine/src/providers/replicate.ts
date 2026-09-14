import { ProviderError, requireApiKey } from "./http.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, ProviderName, StreamChunk } from "./types.js";

interface Prediction { id?: string; output?: unknown; status?: string; error?: unknown; urls?: { stream?: string; get?: string }; }

export class ReplicateAdapter implements ProviderAdapter {
  readonly name: ProviderName = "replicate";
  private readonly baseUrl = "https://api.replicate.com/v1";

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await fetch(`${this.baseUrl}/models/${request.model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireApiKey("REPLICATE_API_TOKEN")}`, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify({ input: { prompt: request.input }, ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}) }),
      signal: request.signal,
    });
    if (!response.ok) throw new ProviderError(`Replicate request failed: ${response.status}`, "replicate", response.status === 408 || response.status === 429 || response.status >= 500, response.status);
    const prediction = await response.json() as Prediction;
    if (prediction.status === "failed" || prediction.error) throw new ProviderError(`Replicate prediction failed: ${String(prediction.error ?? "unknown error")}`, "replicate", false);
    return { provider: "replicate", model: request.model, output: normalizeOutput(prediction.output), requestId: prediction.id };
  }

  async *stream(request: ProviderRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/models/${request.model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireApiKey("REPLICATE_API_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: { prompt: request.input }, stream: true }),
      signal: request.signal,
    });
    if (!response.ok) throw new ProviderError(`Replicate request failed: ${response.status}`, "replicate", response.status === 408 || response.status === 429 || response.status >= 500, response.status);
    const prediction = await response.json() as Prediction;
    if (!prediction.urls?.stream) {
      const result = await this.generate(request);
      yield { provider: "replicate", model: request.model, text: result.output };
      yield { provider: "replicate", model: request.model, text: "", done: true };
      return;
    }
    const stream = await fetch(prediction.urls.stream, { headers: { Authorization: `Bearer ${requireApiKey("REPLICATE_API_TOKEN")}`, Accept: "text/event-stream" }, signal: request.signal });
    if (!stream.ok || !stream.body) throw new ProviderError(`Replicate stream failed: ${stream.status}`, "replicate", stream.status === 408 || stream.status === 429 || stream.status >= 500, stream.status);
    const reader = stream.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const event of events) {
          const eventName = event.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = event.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim() ?? "";
          if (eventName === "output" && data) yield { provider: "replicate", model: request.model, text: data };
          if (eventName === "error") throw new ProviderError(`Replicate stream error: ${data}`, "replicate", false);
          if (eventName === "done") { yield { provider: "replicate", model: request.model, text: "", done: true }; return; }
        }
      }
    } finally { reader.releaseLock(); }
    yield { provider: "replicate", model: request.model, text: "", done: true };
  }
}

function normalizeOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map(String).join("");
  return JSON.stringify(output ?? "");
}
