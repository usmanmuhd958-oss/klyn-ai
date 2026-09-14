import { z } from "zod";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { GeminiAdapter } from "./providers/gemini.js";
import { OpenAIAdapter } from "./providers/openai.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk, ProviderName } from "./providers/types.js";

export interface Telemetry {
  onStart?(event: { provider: ProviderName; model: string }): void;
  onSuccess?(event: { provider: ProviderName; model: string; latencyMs: number; outputTokens?: number }): void;
  onError?(event: { provider: ProviderName; model: string; latencyMs: number; error: unknown; retryable: boolean }): void;
}

export interface RouteTarget { provider: ProviderName; model: string }
export interface RouterOptions {
  targets: RouteTarget[];
  adapters?: Partial<Record<ProviderName, ProviderAdapter>>;
  telemetry?: Telemetry;
  maxAttempts?: number;
}

export class AIProviderRouter {
  private readonly adapters: Record<ProviderName, ProviderAdapter>;
  private readonly telemetry?: Telemetry;
  private readonly maxAttempts: number;
  constructor(private readonly options: RouterOptions) {
    this.adapters = {
      openai: options.adapters?.openai ?? new OpenAIAdapter(),
      anthropic: options.adapters?.anthropic ?? new AnthropicAdapter(),
      gemini: options.adapters?.gemini ?? new GeminiAdapter(),
    };
    this.telemetry = options.telemetry;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? options.targets.length);
    if (options.targets.length === 0) throw new Error("AIProviderRouter requires at least one route target");
  }

  async generate(input: Omit<ProviderRequest, "model"> & { model?: string }): Promise<ProviderResponse> {
    let lastError: unknown;
    let attempts = 0;
    for (const target of this.options.targets) {
      if (attempts++ >= this.maxAttempts) break;
      if (input.model && target.model !== input.model) continue;
      const request = { ...input, model: target.model };
      const started = Date.now(); this.telemetry?.onStart?.(target);
      try {
        const result = await this.adapters[target.provider].generate(request);
        this.telemetry?.onSuccess?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started, outputTokens: result.usage?.outputTokens });
        return result;
      } catch (error) {
        lastError = error;
        const retryable = isRetryable(error);
        this.telemetry?.onError?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started, error, retryable });
        if (!retryable) throw error;
      }
    }
    throw new Error(`All configured AI providers failed: ${formatError(lastError)}`);
  }

  async *stream(input: Omit<ProviderRequest, "model"> & { model?: string }): AsyncIterable<StreamChunk> {
    let lastError: unknown;
    let attempts = 0;
    for (const target of this.options.targets) {
      if (attempts++ >= this.maxAttempts) break;
      if (input.model && target.model !== input.model) continue;
      const started = Date.now(); this.telemetry?.onStart?.(target);
      try {
        let emitted = false;
        for await (const chunk of this.adapters[target.provider].stream({ ...input, model: target.model })) {
          emitted = emitted || chunk.text.length > 0;
          yield chunk;
        }
        this.telemetry?.onSuccess?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started });
        return;
      } catch (error) {
        lastError = error;
        const retryable = isRetryable(error);
        this.telemetry?.onError?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started, error, retryable });
        if (!retryable) throw error;
      }
    }
    throw new Error(`All configured AI streaming providers failed: ${formatError(lastError)}`);
  }

  async generateStructured<T>(input: Omit<ProviderRequest, "model" | "responseFormat"> & { model?: string }, schema: z.ZodType<T>): Promise<{ data: T; response: ProviderResponse }> {
    const response = await this.generate({ ...input, responseFormat: "json" });
    let parsed: unknown;
    try { parsed = JSON.parse(response.output); } catch { throw new Error("Provider returned invalid JSON for structured output"); }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new Error(`Structured output schema validation failed: ${result.error.message}`);
    return { data: result.data, response };
  }
}

function isRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "retryable" in error && (error as { retryable?: unknown }).retryable === true;
}
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
