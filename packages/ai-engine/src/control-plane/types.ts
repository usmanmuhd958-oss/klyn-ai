import type { ProviderAdapter, ProviderName, ProviderResponse } from "../providers/types.js";

export type RoutingObjective =
  | "quality"
  | "latency"
  | "cost"
  | "reliability"
  | "data-sovereignty"
  | "balanced";

export type ProviderHealthState = "healthy" | "degraded" | "rate-limited" | "unavailable" | "unknown";
export type ContextPriority = "required" | "high" | "normal" | "low";
export type ModelCapabilityName = "reasoning" | "structured-output" | "tool-use" | "vision" | "audio";

export interface ModelPricing {
  readonly inputMicrousdPer1kTokens: number;
  readonly outputMicrousdPer1kTokens: number;
}

export interface ModelDefinition {
  readonly provider: ProviderName;
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly capabilities: ReadonlySet<ModelCapabilityName>;
  readonly pricing: ModelPricing;
  readonly evaluationScore?: number;
  readonly evaluationSampleCount?: number;
  readonly dataResidencies?: readonly string[];
  readonly tags?: readonly string[];
}

export interface AiEngineProvider {
  readonly id: string;
  readonly definition: ModelDefinition;
  readonly adapter: ProviderAdapter;
}

export interface ProviderHealthSnapshot {
  readonly providerId: string;
  readonly state: ProviderHealthState;
  readonly consecutiveFailures: number;
  readonly totalSuccesses: number;
  readonly totalFailures: number;
  readonly averageLatencyMs?: number;
  readonly lastSuccessAt?: number;
  readonly lastFailureAt?: number;
  readonly retryAfterAt?: number;
}

export interface ProviderHealthPolicy {
  readonly failureThreshold: number;
  readonly recoveryCooldownMs: number;
  readonly degradedLatencyMs: number;
}

export interface RoutingPolicy {
  readonly objective: RoutingObjective;
  readonly maxAttempts: number;
  readonly maxOutputTokens: number;
  readonly allowedProviders?: readonly ProviderName[];
  readonly deniedProviders?: readonly ProviderName[];
  readonly requiredCapabilities?: readonly ModelCapabilityName[];
  readonly preferredDataResidencies?: readonly string[];
  readonly maxCostMicrousd?: number;
  readonly contextBudgetTokens?: number;
}

export interface ContextItem {
  readonly id: string;
  readonly content: string;
  readonly priority: ContextPriority;
  readonly score: number;
  readonly tokenEstimate?: number;
  readonly required?: boolean;
}

export interface ContextSelectionPolicy {
  readonly maxTokens: number;
  readonly reserveTokens: number;
  readonly maxItems: number;
}

export interface ContextSelectionResult {
  readonly selected: readonly ContextItem[];
  readonly omitted: readonly ContextItem[];
  readonly estimatedTokens: number;
}

export interface AiCompletionRequest {
  readonly input: string;
  readonly system?: string;
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly responseFormat?: "text" | "json";
  readonly signal?: AbortSignal;
  readonly contexts?: readonly ContextItem[];
  readonly contextPolicy?: Partial<ContextSelectionPolicy>;
}

export interface AiCompletionResult {
  readonly response: ProviderResponse;
  readonly providerId: string;
  readonly attempts: number;
  readonly fallbackCount: number;
  readonly context: ContextSelectionResult;
  readonly costMicrousd?: number;
  readonly health: ProviderHealthSnapshot;
}

export type MeterStatus = "complete" | "partial";

export interface TokenMeterRecord {
  readonly providerId: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costMicrousd?: number;
  readonly status: MeterStatus;
  readonly recordedAt: number;
}

export interface AiEngineErrorOptions {
  readonly cause?: unknown;
  readonly providerId?: string;
  readonly retryable?: boolean;
  readonly status?: number;
}

export type AiEngineErrorCode =
  | "INVALID_REQUEST"
  | "POLICY_VIOLATION"
  | "NO_PROVIDER"
  | "CONTEXT_OVERFLOW"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_FAILURE"
  | "ABORTED"
  | "ALL_PROVIDERS_FAILED";

export class AiEngineError extends Error {
  readonly providerId?: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    readonly code: AiEngineErrorCode,
    message: string,
    options: AiEngineErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AiEngineError";
    this.providerId = options.providerId;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}
