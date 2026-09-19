import { ProviderCircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";
import type { ProviderAdapter, ProviderName, ProviderRequest, ProviderResponse } from "./providers/types.js";

export type DynamicRoutingObjective = "balanced" | "latency" | "cost" | "quality";

export interface DynamicProviderCandidate {
  readonly provider: ProviderName;
  readonly model: string;
  readonly adapter: ProviderAdapter;
  readonly capabilities?: readonly string[];
  readonly qualityScore?: number;
  readonly priority?: number;
  /** Estimated micro-USD per 1K input tokens. */
  readonly inputCostMicrousdPer1K?: number;
  /** Estimated micro-USD per 1K output tokens. */
  readonly outputCostMicrousdPer1K?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface DynamicRoutingPolicy {
  readonly objective?: DynamicRoutingObjective;
  readonly requiredCapabilities?: readonly string[];
  readonly maxEstimatedCostMicrousd?: number;
  readonly maxLatencyMs?: number;
  readonly maxCandidates?: number;
}

export interface ProviderHealthSnapshot {
  readonly provider: ProviderName;
  readonly model: string;
  readonly successes: number;
  readonly failures: number;
  readonly latencyEwmaMs?: number;
  readonly lastError?: string;
  readonly lastSuccessAt?: number;
}

export interface DynamicRouteCandidateScore {
  readonly provider: ProviderName;
  readonly model: string;
  readonly score: number;
  readonly estimatedCostMicrousd: number;
  readonly estimatedLatencyMs: number;
  readonly health: number;
}

export interface DynamicRouteDecision {
  readonly provider: ProviderName;
  readonly model: string;
  readonly objective: DynamicRoutingObjective;
  readonly candidates: readonly DynamicRouteCandidateScore[];
}

export interface DynamicProviderRouterOptions {
  readonly candidates: readonly DynamicProviderCandidate[];
  readonly circuitBreaker?: CircuitBreakerOptions;
  readonly initialLatencyMs?: number;
  readonly latencyEwmaAlpha?: number;
}

interface ProviderHealthState {
  successes: number;
  failures: number;
  latencyEwmaMs?: number;
  lastError?: string;
  lastSuccessAt?: number;
}

function normalizeUnit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function weightedScore(
  objective: DynamicRoutingObjective,
  health: number,
  latency: number,
  cost: number,
  quality: number,
  priority: number,
): number {
  switch (objective) {
    case "latency":
      return 0.55 * latency + 0.20 * health + 0.15 * quality + 0.10 * priority;
    case "cost":
      return 0.55 * cost + 0.20 * health + 0.15 * quality + 0.10 * priority;
    case "quality":
      return 0.55 * quality + 0.20 * health + 0.15 * latency + 0.10 * priority;
    case "balanced":
    default:
      return 0.35 * health + 0.25 * quality + 0.20 * latency + 0.10 * cost + 0.10 * priority;
  }
}

export class DynamicProviderRouter {
  private readonly candidates: readonly DynamicProviderCandidate[];
  private readonly circuitBreaker: ProviderCircuitBreaker;
  private readonly health = new Map<string, ProviderHealthState>();
  private readonly initialLatencyMs: number;
  private readonly latencyEwmaAlpha: number;
  private lastDecision?: DynamicRouteDecision;

  public constructor(options: DynamicProviderRouterOptions) {
    if (options.candidates.length === 0) throw new Error("DynamicProviderRouter requires at least one candidate");
    const keys = new Set<string>();
    for (const candidate of options.candidates) {
      if (!candidate.model.trim()) throw new Error("Provider candidate model must be non-empty");
      const key = this.key(candidate);
      if (keys.has(key)) throw new Error(`Duplicate provider candidate: ${key}`);
      keys.add(key);
      if (candidate.qualityScore !== undefined && (!Number.isFinite(candidate.qualityScore) || candidate.qualityScore < 0 || candidate.qualityScore > 1)) {
        throw new Error(`qualityScore must be between 0 and 1 for ${key}`);
      }
      if (candidate.priority !== undefined && (!Number.isFinite(candidate.priority) || candidate.priority < 0)) {
        throw new Error(`priority must be non-negative for ${key}`);
      }
    }
    this.candidates = Object.freeze([...options.candidates]);
    this.circuitBreaker = new ProviderCircuitBreaker(options.circuitBreaker);
    this.initialLatencyMs = Math.max(1, options.initialLatencyMs ?? 750);
    this.latencyEwmaAlpha = clamp01(options.latencyEwmaAlpha ?? 0.35);
  }

  public route(request: Omit<ProviderRequest, "model"> & { model?: string }, policy: DynamicRoutingPolicy = {}): DynamicRouteDecision {
    const objective = policy.objective ?? "balanced";
    const requiredCapabilities = new Set(policy.requiredCapabilities ?? []);
    const eligible = this.candidates.filter((candidate) => {
      if (request.model && request.model !== candidate.model) return false;
      if (!this.circuitBreaker.canRequest(candidate.provider)) return false;
      if ([...requiredCapabilities].some((capability) => !candidate.capabilities?.includes(capability))) return false;
      return true;
    });

    if (eligible.length === 0) {
      throw new Error("No healthy provider candidate satisfies the requested routing policy");
    }

    const maxCandidates = Math.max(1, Math.floor(policy.maxCandidates ?? eligible.length));
    const raw = eligible.map((candidate) => {
      const state = this.health.get(this.key(candidate));
      const estimatedLatencyMs = state?.latencyEwmaMs ?? this.initialLatencyMs;
      const estimatedCostMicrousd =
        (Math.max(0, request.input.length) / 4_000) * normalizeUnit(candidate.inputCostMicrousdPer1K, 0) +
        (normalizeUnit(request.maxOutputTokens, 0) / 1_000) * normalizeUnit(candidate.outputCostMicrousdPer1K, 0);
      const health = this.healthScore(state);
      const latency = 1 / Math.max(1, estimatedLatencyMs);
      const latencyRange = 1 / Math.max(1, estimatedLatencyMs);
      const cost = 1 / (1 + estimatedCostMicrousd);
      const quality = clamp01(candidate.qualityScore ?? 0.5);
      const priority = 1 / (1 + normalizeUnit(candidate.priority, 0));
      return {
        provider: candidate.provider,
        model: candidate.model,
        score: weightedScore(
          objective,
          health,
          latency / Math.max(1, latencyRange),
          cost,
          quality,
          priority,
        ),
        estimatedCostMicrousd,
        estimatedLatencyMs,
        health,
      };
    }).filter((candidate) => policy.maxEstimatedCostMicrousd === undefined || candidate.estimatedCostMicrousd <= policy.maxEstimatedCostMicrousd)
      .filter((candidate) => policy.maxLatencyMs === undefined || candidate.estimatedLatencyMs <= policy.maxLatencyMs)
      .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
      .slice(0, maxCandidates);

    if (raw.length === 0) throw new Error("No provider candidate satisfies the cost/latency constraints");
    const selected = raw[0]!;
    const decision: DynamicRouteDecision = Object.freeze({
      provider: selected.provider,
      model: selected.model,
      objective,
      candidates: Object.freeze(raw.map((item) => Object.freeze(item))),
    });
    this.lastDecision = decision;
    return decision;
  }

  public async generate(
    request: Omit<ProviderRequest, "model"> & { model?: string },
    policy: DynamicRoutingPolicy = {},
  ): Promise<ProviderResponse> {
    let remaining = new Set(this.route(request, { ...policy, maxCandidates: policy.maxCandidates ?? this.candidates.length }).candidates.map((candidate) => this.key(candidate)));
    let lastError: unknown;

    while (remaining.size > 0) {
      const candidates = this.route(request, { ...policy, maxCandidates: this.candidates.length }).candidates.filter((candidate) => remaining.has(this.key(candidate)));
      const decision = candidates[0];
      if (!decision) break;
      const candidate = this.candidates.find((entry) => entry.provider === decision.provider && entry.model === decision.model);
      if (!candidate) break;
      remaining.delete(this.key(candidate));

      const startedAt = performance.now();
      try {
        this.circuitBreaker.assertRequestAllowed(candidate.provider);
        const response = await candidate.adapter.generate({ ...request, model: candidate.model });
        const latencyMs = performance.now() - startedAt;
        this.recordSuccess(candidate, latencyMs);
        return response;
      } catch (error) {
        lastError = error;
        this.recordFailure(candidate, performance.now() - startedAt, error);
      }
    }

    throw new Error(`Dynamic provider routing exhausted all candidates: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  public healthSnapshot(): readonly ProviderHealthSnapshot[] {
    return Object.freeze(this.candidates.map((candidate) => {
      const state = this.health.get(this.key(candidate)) ?? { successes: 0, failures: 0 };
      return Object.freeze({
        provider: candidate.provider,
        model: candidate.model,
        successes: state.successes,
        failures: state.failures,
        ...(state.latencyEwmaMs === undefined ? {} : { latencyEwmaMs: state.latencyEwmaMs }),
        ...(state.lastError === undefined ? {} : { lastError: state.lastError }),
        ...(state.lastSuccessAt === undefined ? {} : { lastSuccessAt: state.lastSuccessAt }),
      });
    }));
  }

  public lastRoute(): DynamicRouteDecision | undefined {
    return this.lastDecision;
  }

  public reset(provider?: ProviderName): void {
    this.circuitBreaker.reset(provider);
    if (provider === undefined) {
      this.health.clear();
      return;
    }
    for (const candidate of this.candidates) {
      if (candidate.provider === provider) this.health.delete(this.key(candidate));
    }
  }

  private recordSuccess(candidate: DynamicProviderCandidate, latencyMs: number): void {
    const key = this.key(candidate);
    const state = this.health.get(key) ?? { successes: 0, failures: 0 };
    state.successes += 1;
    state.latencyEwmaMs = state.latencyEwmaMs === undefined
      ? latencyMs
      : this.latencyEwmaAlpha * latencyMs + (1 - this.latencyEwmaAlpha) * state.latencyEwmaMs;
    state.lastSuccessAt = Date.now();
    state.lastError = undefined;
    this.health.set(key, state);
    this.circuitBreaker.recordSuccess(candidate.provider);
  }

  private recordFailure(candidate: DynamicProviderCandidate, latencyMs: number, error: unknown): void {
    const key = this.key(candidate);
    const state = this.health.get(key) ?? { successes: 0, failures: 0 };
    state.failures += 1;
    state.latencyEwmaMs = state.latencyEwmaMs === undefined
      ? latencyMs
      : this.latencyEwmaAlpha * latencyMs + (1 - this.latencyEwmaAlpha) * state.latencyEwmaMs;
    state.lastError = error instanceof Error ? error.message : String(error);
    this.health.set(key, state);
    this.circuitBreaker.recordFailure(candidate.provider);
  }

  private healthScore(state: ProviderHealthState | undefined): number {
    if (!state) return 1;
    const attempts = state.successes + state.failures;
    if (attempts === 0) return 1;
    return clamp01((state.successes + 1) / (attempts + 2));
  }

  private key(candidate: Pick<DynamicProviderCandidate, "provider" | "model">): string {
    return `${candidate.provider}:${candidate.model}`;
  }
}
