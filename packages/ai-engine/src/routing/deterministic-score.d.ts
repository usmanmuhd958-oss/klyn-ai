import type { ProviderName } from "../providers/types.js";
import { type ExecutionRequest, type ProviderCostEntry, type ProviderCostMatrix, type RouteCandidate, type RouteCandidateInput, type RouteDecision, type RoutingPolicy } from "./contracts.js";
export declare function calculateRouteScore(candidate: RouteCandidateInput, policy: RoutingPolicy): number;
export declare function compareRouteCandidates(left: RouteCandidate, right: RouteCandidate): number;
export declare function scoreRouteCandidate(candidate: RouteCandidateInput, policy: RoutingPolicy): RouteCandidate;
export declare function rankRouteCandidates(candidates: readonly RouteCandidateInput[], policy: RoutingPolicy): readonly RouteCandidate[];
export declare function decideRoute(request: ExecutionRequest, candidates: readonly RouteCandidateInput[]): RouteDecision;
export declare function providerCostKey(provider: ProviderName, model: string): string;
export declare function findProviderCost(matrix: ProviderCostMatrix, provider: ProviderName, model: string): ProviderCostEntry;
export declare function estimateCostMicrousd(matrix: ProviderCostMatrix, provider: ProviderName, model: string, inputTokens: number, outputTokens: number): number;
//# sourceMappingURL=deterministic-score.d.ts.map