import { z } from "zod";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { GeminiAdapter } from "./providers/gemini.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { ReplicateAdapter } from "./providers/replicate.js";
import { UniversalChatAdapter } from "./providers/universal.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamChunk, ProviderName } from "./providers/types.js";

export interface Telemetry { onStart?(event: { provider: ProviderName; model: string }): void; onSuccess?(event: { provider: ProviderName; model: string; latencyMs: number; outputTokens?: number }): void; onError?(event: { provider: ProviderName; model: string; latencyMs: number; error: unknown; retryable: boolean }): void; }
export interface RouteTarget { provider: ProviderName; model: string }
export interface RouterOptions { targets: RouteTarget[]; adapters?: Partial<Record<ProviderName, ProviderAdapter>>; telemetry?: Telemetry; maxAttempts?: number; }
const UNIVERSAL_DEFAULTS: Partial<Record<ProviderName, { baseUrl: string; apiKeyEnv?: string }>> = {
  deepseek: { baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" }, openrouter: { baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" }, groq: { baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" }, together: { baseUrl: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY" }, fireworks: { baseUrl: "https://api.fireworks.ai/inference/v1", apiKeyEnv: "FIREWORKS_API_KEY" }, mistral: { baseUrl: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY" }, cohere: { baseUrl: "https://api.cohere.com/compatibility/v1", apiKeyEnv: "COHERE_API_KEY" }, ollama: { baseUrl: "http://127.0.0.1:11434/v1" }, vllm: { baseUrl: "http://127.0.0.1:8000/v1" }, lmstudio: { baseUrl: "http://127.0.0.1:1234/v1" }, custom: { baseUrl: "http://127.0.0.1:8080/v1" },
};

export class AIProviderRouter {
  private readonly adapters: Partial<Record<ProviderName, ProviderAdapter>>; private readonly telemetry?: Telemetry; private readonly maxAttempts: number;
  constructor(private readonly options: RouterOptions) {
    this.adapters = { openai: options.adapters?.openai ?? new OpenAIAdapter(), anthropic: options.adapters?.anthropic ?? new AnthropicAdapter(), gemini: options.adapters?.gemini ?? new GeminiAdapter(), replicate: options.adapters?.replicate ?? new ReplicateAdapter(), ...this.createUniversalAdapters(options.targets, options.adapters), ...options.adapters };
    this.telemetry = options.telemetry; this.maxAttempts = Math.max(1, options.maxAttempts ?? options.targets.length); if (options.targets.length === 0) throw new Error("AIProviderRouter requires at least one route target");
  }
  async generate(input: Omit<ProviderRequest, "model"> & { model?: string }): Promise<ProviderResponse> {
    let lastError: unknown; let attempts = 0; for (const target of this.options.targets) { if (attempts++ >= this.maxAttempts) break; if (input.model && target.model !== input.model) continue; const adapter = this.requireAdapter(target.provider); const request = { ...input, model: target.model }; const started = Date.now(); this.telemetry?.onStart?.(target); try { const result = await adapter.generate(request); this.telemetry?.onSuccess?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started, outputTokens: result.usage?.outputTokens }); return result; } catch (error) { lastError = error; const retryable = isRetryable(error); this.telemetry?.onError?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started, error, retryable }); if (!retryable) throw error; } }
    throw new Error(`All configured AI providers failed: ${formatError(lastError)}`);
  }
  async *stream(input: Omit<ProviderRequest, "model"> & { model?: string }): AsyncIterable<StreamChunk> {
    let lastError: unknown; let attempts = 0; for (const target of this.options.targets) { if (attempts++ >= this.maxAttempts) break; if (input.model && target.model !== input.model) continue; const adapter = this.requireAdapter(target.provider); const started = Date.now(); this.telemetry?.onStart?.(target); try { for await (const chunk of adapter.stream({ ...input, model: target.model })) yield chunk; this.telemetry?.onSuccess?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started }); return; } catch (error) { lastError = error; const retryable = isRetryable(error); this.telemetry?.onError?.({ provider: target.provider, model: target.model, latencyMs: Date.now() - started, error, retryable }); if (!retryable) throw error; } }
    throw new Error(`All configured AI streaming providers failed: ${formatError(lastError)}`);
  }
  async generateStructured<T>(input: Omit<ProviderRequest, "model" | "responseFormat"> & { model?: string }, schema: z.ZodType<T>): Promise<{ data: T; response: ProviderResponse }> { const response = await this.generate({ ...input, responseFormat: "json" }); let parsed: unknown; try { parsed = JSON.parse(response.output); } catch { throw new Error("Provider returned invalid JSON for structured output"); } const result = schema.safeParse(parsed); if (!result.success) throw new Error(`Structured output schema validation failed: ${result.error.message}`); return { data: result.data, response }; }
  private createUniversalAdapters(targets: RouteTarget[], configured?: Partial<Record<ProviderName, ProviderAdapter>>): Partial<Record<ProviderName, ProviderAdapter>> { const providers = new Set(targets.map((target) => target.provider)); const adapters: Partial<Record<ProviderName, ProviderAdapter>> = {}; for (const provider of providers) { if (configured?.[provider] || provider === "openai" || provider === "anthropic" || provider === "gemini" || provider === "replicate") continue; const defaults = UNIVERSAL_DEFAULTS[provider]; if (!defaults) continue; adapters[provider] = new UniversalChatAdapter({ name: provider, ...defaults }); } return adapters; }
  private requireAdapter(provider: ProviderName): ProviderAdapter { const adapter = this.adapters[provider]; if (!adapter) throw new Error(`No adapter configured for provider: ${provider}`); return adapter; }
}
function isRetryable(error: unknown): boolean { return typeof error === "object" && error !== null && "retryable" in error && (error as { retryable?: unknown }).retryable === true; }
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
