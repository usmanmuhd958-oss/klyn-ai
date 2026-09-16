// =============================================================================
// KLYN AI OS — 1.brain — Dynamic Multi-Model Cascade Router & Cost Optimizer
// File: 1.brain/cascade_router.ts
//
// Phase 5 capability #3. An adaptive model router that evaluates task
// complexity, SLA constraints, and confidence metrics before dispatching LLM
// calls:
//
//   - TIER 0 (fast): gpt-4o-mini, claude-haiku-4-5, gemini-2.5-flash,
//     deepseek-chat — cheap, low latency. Handles sub-tasks (AST parsing,
//     syntax repair, extraction) and any task whose complexity is below the
//     fast threshold.
//   - TIER 2 (reasoning): deepseek-reasoner, claude-sonnet-4-5, gpt-4o —
//     heavy reasoning. Escalated ONLY when confidence falls below the
//     threshold or the task demands reasoning by policy.
//
//   decide(task)   — deterministic selection from complexity + SLA + policy
//   execute(task)  — fast attempt → confidence check → conditional escalation
//                    to reasoning; reports the USD saved vs. reasoning-only
//   Every decision, escalation, cost, and latency sample is streamed to the
//   central EventBus (`cascade:*` events) for real-time dashboards.
//
// Cost math uses the canonical MODEL_REGISTRY keys (costPerMToken /
// costPerMTokenOutput) — the same keys Phase 2 aligned across providers.
// =============================================================================
import { EventBus, type KlynEvent } from '../packages/core-runtime/src/EventBus.js';
import { MODEL_REGISTRY } from './config.js';

export type ModelTier = 'fast' | 'standard' | 'reasoning';

export interface CascadeModel {
  name: string;
  provider: string;
  tier: ModelTier;
  costPerMToken: number;
  costPerMTokenOutput: number;
  /** Rolling average latency in ms (maintained from executions). */
  avgLatencyMs: number;
}

export interface CascadeTask {
  /** Domain/kind label (e.g. 'ast_parse', 'syntax_repair', 'architecture'). */
  kind: string;
  /** Complexity score 0..1 (1 = hardest). */
  complexity: number;
  /** Hard latency SLA in ms (0 = none). */
  slaMs?: number;
  /** Expected token budget. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  /** Policy override: never route this kind to fast models. */
  requireReasoning?: boolean;
  /** The payload that the model call will consume (for telemetry). */
  content?: string;
}

export interface CascadeDecision {
  task: CascadeTask;
  /** Selected tier-0 model. */
  fastModel: string;
  /** Reasoning model reserved for escalation. */
  reasoningModel: string;
  /** True when the task must start at the reasoning tier. */
  escalatedByPolicy: boolean;
  /** Deterministic routing reason. */
  reason: string;
  estimatedCostUsd: number;
}

export interface ModelCall {
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  content?: string;
  /** Provider-returned confidence 0..1 (1 = certain). */
  confidence: number;
}

export interface CascadeOutcome {
  decision: CascadeDecision;
  /** Calls actually made (fast attempt, possibly escalation). */
  calls: ModelCall[];
  escalated: boolean;
  /** Final answer (from the last call). */
  result: unknown;
  /** Confidence of the final call. */
  confidence: number;
  /** Actual USD spent across calls. */
  actualCostUsd: number;
  /** USD that a reasoning-only execution would have cost. */
  reasoningOnlyCostUsd: number;
  /** actualCost - reasoningOnly (negative = savings). */
  savingsUsd: number;
  totalLatencyMs: number;
}

export interface CascadeStats {
  decisions: number;
  escalations: number;
  totalCostUsd: number;
  totalSavingsUsd: number;
  perModel: Record<string, { calls: number; avgLatencyMs: number; costUsd: number }>;
}

export interface CascadeOptions {
  /** Confidence below this escalates to reasoning (default 0.85). */
  confidenceThreshold?: number;
  /** Complexity at or above this starts at reasoning (default 0.8). */
  reasoningComplexity?: number;
  /** Complexity below this always routes to fast (default 0.55). */
  fastComplexity?: number;
  /** Fast-model latency SLA in ms — stricter SLAs skip fast (default 800). */
  fastLatencySlaMs?: number;
  bus?: EventBus;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
const DEFAULT_REASONING_COMPLEXITY = 0.8;
const DEFAULT_FAST_COMPLEXITY = 0.55;
const DEFAULT_FAST_LATENCY_SLA_MS = 800;

/** Canonical tier assignment grounded in the real MODEL_REGISTRY. */
const TIER_MODELS: Record<ModelTier, string[]> = {
  fast: ['gpt-4o-mini', 'claude-haiku-4-5', 'gemini-2.5-flash', 'deepseek-chat'],
  standard: ['gpt-4o', 'claude-sonnet-4-5'],
  reasoning: ['deepseek-reasoner', 'claude-sonnet-4-5'],
};

/** Kinds that must never hit a fast model (policy override). */
const POLICY_REASONING_KINDS = new Set(['architecture', 'security_review', 'migration_design']);

export class CascadeRouter {
  private models = new Map<string, CascadeModel>();
  private stats: CascadeStats = { decisions: 0, escalations: 0, totalCostUsd: 0, totalSavingsUsd: 0, perModel: {} };

  private readonly confidenceThreshold: number;
  private readonly reasoningComplexity: number;
  private readonly fastComplexity: number;
  private readonly fastLatencySlaMs: number;
  private readonly bus: EventBus;

  constructor(options: CascadeOptions = {}) {
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.reasoningComplexity = options.reasoningComplexity ?? DEFAULT_REASONING_COMPLEXITY;
    this.fastComplexity = options.fastComplexity ?? DEFAULT_FAST_COMPLEXITY;
    this.fastLatencySlaMs = options.fastLatencySlaMs ?? DEFAULT_FAST_LATENCY_SLA_MS;
    this.bus = options.bus ?? new EventBus();

    // Load every tier model that exists in the registry (real IDs + real costs).
    for (const tier of ['fast', 'standard', 'reasoning'] as ModelTier[]) {
      for (const name of TIER_MODELS[tier]) {
        const entry = MODEL_REGISTRY[name];
        if (!entry) continue;
        this.models.set(name, {
          name,
          provider: entry.provider ?? name,
          tier,
          costPerMToken: entry.costPerMToken ?? entry.inputCostPer1k * 1000,
          costPerMTokenOutput: entry.costPerMTokenOutput ?? entry.outputCostPer1k * 1000,
          avgLatencyMs: tier === 'fast' ? 300 : tier === 'standard' ? 900 : 1500,
        });
      }
    }
  }

  /** Deterministic tier selection for a task (no I/O, O(models)). */
  decide(task: CascadeTask): CascadeDecision {
    const fast = this.models.get(TIER_MODELS.fast[0])!;
    const reasoning = this.models.get(TIER_MODELS.reasoning[0])!;
    const policyReasoning = task.requireReasoning === true || POLICY_REASONING_KINDS.has(task.kind);
    const slaTooStrict = (task.slaMs ?? 0) > 0 && task.slaMs < this.fastLatencySlaMs;

    let reason: string;
    let escalatedByPolicy: boolean;
    if (policyReasoning) {
      reason = `kind "${task.kind}" requires reasoning by policy`;
      escalatedByPolicy = true;
    } else if (task.complexity >= this.reasoningComplexity) {
      reason = `complexity ${task.complexity.toFixed(2)} >= reasoning threshold ${this.reasoningComplexity}`;
      escalatedByPolicy = true;
    } else if (slaTooStrict) {
      reason = `SLA ${task.slaMs}ms below fast-model budget ${this.fastLatencySlaMs}ms`;
      escalatedByPolicy = true;
    } else {
      reason = `complexity ${task.complexity.toFixed(2)} below fast ceiling ${this.fastComplexity}`;
      escalatedByPolicy = false;
    }

    const input = task.estimatedInputTokens ?? 500;
    const output = task.estimatedOutputTokens ?? 200;
    const estimatedCostUsd = this.costUsd(fast, input, output);

    return { task, fastModel: fast.name, reasoningModel: reasoning.name, escalatedByPolicy, reason, estimatedCostUsd };
  }

  /**
   * Execute the cascade: run the fast tier first (unless policy/SLA demands
   * reasoning), check the returned confidence, and escalate to the reasoning
   * tier only when confidence < threshold. Streams cost + latency telemetry
   * to the EventBus on every call.
   */
  async execute(
    task: CascadeTask,
    callModel: (model: string, task: CascadeTask) => Promise<Partial<ModelCall>>
  ): Promise<CascadeOutcome> {
    const decision = this.decide(task);
    this.stats.decisions++;
    this.publish('cascade:decision', decision);

    const calls: ModelCall[] = [];
    const started = performance.now();

    const run = async (modelName: string): Promise<{ call: ModelCall; result: unknown }> => {
      const model = this.models.get(modelName)!;
      const t0 = performance.now();
      const partial = await callModel(modelName, task);
      const latencyMs = partial.latencyMs ?? performance.now() - t0;
      const call: ModelCall = {
        model: modelName,
        tier: model.tier,
        inputTokens: partial.inputTokens ?? task.estimatedInputTokens ?? 500,
        outputTokens: partial.outputTokens ?? task.estimatedOutputTokens ?? 200,
        latencyMs,
        confidence: partial.confidence ?? 1,
        content: partial.content ?? task.content,
      };
      // Rolling latency average + per-model telemetry.
      model.avgLatencyMs = model.avgLatencyMs * 0.9 + call.latencyMs * 0.1;
      const entry = this.stats.perModel[modelName] ?? { calls: 0, avgLatencyMs: 0, costUsd: 0 };
      entry.calls++;
      entry.avgLatencyMs = entry.avgLatencyMs * (entry.calls - 1) / entry.calls + call.latencyMs / entry.calls;
      entry.costUsd += this.costUsd(model, call.inputTokens, call.outputTokens);
      this.stats.perModel[modelName] = entry;
      calls.push(call);
      this.publish('cascade:call', { ...call, taskKind: task.kind });
      return { call, result: partial.content };
    };

    let result: unknown;
    let confidence = 1;
    let escalated = false;

    if (decision.escalatedByPolicy) {
      const { call, result: r } = await run(decision.reasoningModel);
      result = r;
      confidence = call.confidence;
      this.publish('cascade:escalation', { taskKind: task.kind, model: call.model, reason: decision.reason });
      this.stats.escalations++;
      escalated = true;
    } else {
      const fast = await run(decision.fastModel);
      result = fast.result;
      confidence = fast.call.confidence;
      if (confidence < this.confidenceThreshold) {
        const heavy = await run(decision.reasoningModel);
        result = heavy.result;
        confidence = heavy.call.confidence;
        this.publish('cascade:escalation', { taskKind: task.kind, model: heavy.call.model, reason: `confidence ${confidence.toFixed(2)} < ${this.confidenceThreshold}` });
        this.stats.escalations++;
        escalated = true;
      }
    }

    const actualCostUsd = calls.reduce((sum, c) => sum + this.costUsd(this.models.get(c.model)!, c.inputTokens, c.outputTokens), 0);
    const reasoningOnlyCostUsd = this.costUsd(this.models.get(decision.reasoningModel)!, decision.task.estimatedInputTokens ?? 500, decision.task.estimatedOutputTokens ?? 200);
    const savingsUsd = actualCostUsd - reasoningOnlyCostUsd;
    this.stats.totalCostUsd += actualCostUsd;
    this.stats.totalSavingsUsd += savingsUsd;

    const outcome: CascadeOutcome = {
      decision,
      calls,
      escalated,
      result,
      confidence,
      actualCostUsd,
      reasoningOnlyCostUsd,
      savingsUsd,
      totalLatencyMs: performance.now() - started,
    };
    this.publish('cascade:cost', { taskKind: task.kind, actualCostUsd, savingsUsd, escalated });
    return outcome;
  }

  /** Canonical USD cost for a token budget (per-MToken registry keys). */
  costUsd(model: CascadeModel, inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * model.costPerMToken + (outputTokens / 1_000_000) * model.costPerMTokenOutput;
  }

  getStats(): CascadeStats {
    return {
      decisions: this.stats.decisions,
      escalations: this.stats.escalations,
      totalCostUsd: this.stats.totalCostUsd,
      totalSavingsUsd: this.stats.totalSavingsUsd,
      perModel: Object.fromEntries(Object.entries(this.stats.perModel).map(([k, v]) => [k, { ...v }])),
    };
  }

  listModels(): CascadeModel[] {
    return Array.from(this.models.values()).map((m) => ({ ...m }));
  }

  private publish(type: string, payload: unknown): void {
    this.bus.publish({ type, payload, timestamp: Date.now() } satisfies KlynEvent);
  }
}

export default CascadeRouter;
