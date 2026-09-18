import type { ModelCapabilityName } from "../control-plane/types.js";
import type { ProviderName } from "../providers/types.js";
export declare const TASK_TYPES: readonly ["code-generation", "code-review", "refactoring", "debugging", "planning", "reasoning", "analysis", "general"];
export type TaskType = (typeof TASK_TYPES)[number];
export interface ProviderCostEntry {
    readonly provider: ProviderName;
    readonly model: string;
    readonly inputMicrousdPer1kTokens: number;
    readonly outputMicrousdPer1kTokens: number;
}
export interface ProviderCostMatrix {
    readonly entries: readonly ProviderCostEntry[];
}
export interface RoutingWeights {
    readonly qualityBps: number;
    readonly reliabilityBps: number;
    readonly latencyBps: number;
    readonly costBps: number;
}
export type RoutingObjective = "quality" | "latency" | "cost" | "reliability" | "data-sovereignty" | "balanced";
export interface RoutingPolicy {
    readonly objective: RoutingObjective;
    readonly maxAttempts: number;
    readonly maxOutputTokens: number;
    readonly allowedProviders?: readonly ProviderName[];
    readonly deniedProviders?: readonly ProviderName[];
    readonly requiredCapabilities?: readonly ModelCapabilityName[];
    readonly preferredDataResidencies?: readonly string[];
    readonly maxCostMicrousd?: number;
    readonly maxLatencyMs?: number;
    readonly weights?: RoutingWeights;
    readonly contextBudgetTokens?: number;
}
export interface ExecutionRequest {
    readonly requestId: string;
    readonly taskType: TaskType;
    readonly estimatedInputTokens: number;
    readonly estimatedOutputTokens: number;
    readonly policy: RoutingPolicy;
    readonly requiredCapabilities?: readonly ModelCapabilityName[];
}
export interface RouteCandidateInput {
    readonly candidateId: string;
    readonly provider: ProviderName;
    readonly model: string;
    readonly qualityScoreBps: number;
    readonly reliabilityScoreBps: number;
    readonly latencyMs: number;
    readonly estimatedCostMicrousd: number;
}
export interface RouteCandidate extends RouteCandidateInput {
    readonly scoreBps: number;
}
export type RouteDecisionStatus = "selected" | "no-eligible-candidate";
export interface RouteDecision {
    readonly status: RouteDecisionStatus;
    readonly requestId: string;
    readonly selectedCandidate: RouteCandidate | null;
    readonly rankedCandidates: readonly RouteCandidate[];
    readonly reason: "highest-deterministic-score" | "no-candidate-within-policy";
}
export declare const DEFAULT_ROUTING_WEIGHTS: RoutingWeights;
export declare const DEFAULT_MAX_LATENCY_MS = 10000;
export declare const ROUTING_SCORE_BPS = 10000;
//# sourceMappingURL=contracts.d.ts.map