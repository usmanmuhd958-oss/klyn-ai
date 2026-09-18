import { DEFAULT_MAX_LATENCY_MS, DEFAULT_ROUTING_WEIGHTS, ROUTING_SCORE_BPS, } from "./contracts.js";
function assertFiniteNonNegativeInteger(value, fieldName) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${fieldName} must be a non-negative safe integer`);
    }
}
function assertScoreBps(value, fieldName) {
    assertFiniteNonNegativeInteger(value, fieldName);
    if (value > ROUTING_SCORE_BPS) {
        throw new Error(`${fieldName} must be between 0 and ${ROUTING_SCORE_BPS}`);
    }
}
function assertRoutingWeights(weights) {
    assertScoreBps(weights.qualityBps, "weights.qualityBps");
    assertScoreBps(weights.reliabilityBps, "weights.reliabilityBps");
    assertScoreBps(weights.latencyBps, "weights.latencyBps");
    assertScoreBps(weights.costBps, "weights.costBps");
    const total = weights.qualityBps +
        weights.reliabilityBps +
        weights.latencyBps +
        weights.costBps;
    if (total !== ROUTING_SCORE_BPS) {
        throw new Error(`routing weights must sum to ${ROUTING_SCORE_BPS}, received ${total}`);
    }
}
function effectiveWeights(policy) {
    const weights = policy.weights ?? DEFAULT_ROUTING_WEIGHTS;
    assertRoutingWeights(weights);
    return weights;
}
function clampScore(value) {
    return Math.max(0, Math.min(ROUTING_SCORE_BPS, value));
}
function lowerIsBetterScore(value, reference) {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error("metric value must be finite and non-negative");
    }
    if (!Number.isFinite(reference) || reference <= 0) {
        throw new Error("metric reference must be finite and greater than zero");
    }
    const normalized = ((reference - value) * ROUTING_SCORE_BPS) / reference;
    return Math.round(clampScore(normalized));
}
export function calculateRouteScore(candidate, policy) {
    assertScoreBps(candidate.qualityScoreBps, "candidate.qualityScoreBps");
    assertScoreBps(candidate.reliabilityScoreBps, "candidate.reliabilityScoreBps");
    if (!Number.isFinite(candidate.latencyMs) || candidate.latencyMs < 0) {
        throw new Error("candidate.latencyMs must be finite and non-negative");
    }
    if (!Number.isFinite(candidate.estimatedCostMicrousd) ||
        candidate.estimatedCostMicrousd < 0) {
        throw new Error("candidate.estimatedCostMicrousd must be finite and non-negative");
    }
    const weights = effectiveWeights(policy);
    const maxLatencyMs = policy.maxLatencyMs ?? DEFAULT_MAX_LATENCY_MS;
    const latencyScoreBps = lowerIsBetterScore(candidate.latencyMs, maxLatencyMs);
    const maxCostMicrousd = policy.maxCostMicrousd ?? 1_000_000;
    const costScoreBps = lowerIsBetterScore(candidate.estimatedCostMicrousd, maxCostMicrousd);
    const weightedTotal = candidate.qualityScoreBps * weights.qualityBps +
        candidate.reliabilityScoreBps * weights.reliabilityBps +
        latencyScoreBps * weights.latencyBps +
        costScoreBps * weights.costBps;
    return Math.floor(weightedTotal / ROUTING_SCORE_BPS);
}
function compareLexical(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftCode = left.charCodeAt(index);
        const rightCode = right.charCodeAt(index);
        if (leftCode < rightCode)
            return -1;
        if (leftCode > rightCode)
            return 1;
    }
    if (left.length < right.length)
        return -1;
    if (left.length > right.length)
        return 1;
    return 0;
}
function candidateLexicalKey(candidate) {
    return [candidate.provider, candidate.model, candidate.candidateId].join("\u0000");
}
export function compareRouteCandidates(left, right) {
    if (left.scoreBps > right.scoreBps)
        return -1;
    if (left.scoreBps < right.scoreBps)
        return 1;
    return compareLexical(candidateLexicalKey(left), candidateLexicalKey(right));
}
export function scoreRouteCandidate(candidate, policy) {
    return Object.freeze({
        ...candidate,
        scoreBps: calculateRouteScore(candidate, policy),
    });
}
export function rankRouteCandidates(candidates, policy) {
    const scored = candidates.map((candidate) => scoreRouteCandidate(candidate, policy));
    return Object.freeze([...scored].sort(compareRouteCandidates));
}
function isPolicyEligible(candidate, policy) {
    if (policy.maxCostMicrousd !== undefined &&
        candidate.estimatedCostMicrousd > policy.maxCostMicrousd) {
        return false;
    }
    if (policy.maxLatencyMs !== undefined &&
        candidate.latencyMs > policy.maxLatencyMs) {
        return false;
    }
    if (policy.allowedProviders !== undefined &&
        !policy.allowedProviders.includes(candidate.provider)) {
        return false;
    }
    if (policy.deniedProviders?.includes(candidate.provider) === true) {
        return false;
    }
    return true;
}
export function decideRoute(request, candidates) {
    const eligible = candidates.filter((candidate) => isPolicyEligible(candidate, request.policy));
    const rankedCandidates = rankRouteCandidates(eligible, request.policy);
    const selectedCandidate = rankedCandidates[0] ?? null;
    if (selectedCandidate === null) {
        return Object.freeze({
            status: "no-eligible-candidate",
            requestId: request.requestId,
            selectedCandidate: null,
            rankedCandidates,
            reason: "no-candidate-within-policy",
        });
    }
    return Object.freeze({
        status: "selected",
        requestId: request.requestId,
        selectedCandidate,
        rankedCandidates,
        reason: "highest-deterministic-score",
    });
}
export function providerCostKey(provider, model) {
    return `${provider}\u0000${model}`;
}
export function findProviderCost(matrix, provider, model) {
    const match = matrix.entries.find((entry) => entry.provider === provider && entry.model === model);
    if (match === undefined) {
        throw new Error(`missing provider cost entry: ${provider}/${model}`);
    }
    return match;
}
export function estimateCostMicrousd(matrix, provider, model, inputTokens, outputTokens) {
    assertFiniteNonNegativeInteger(inputTokens, "inputTokens");
    assertFiniteNonNegativeInteger(outputTokens, "outputTokens");
    const pricing = findProviderCost(matrix, provider, model);
    const inputCost = (inputTokens * pricing.inputMicrousdPer1kTokens) / 1_000;
    const outputCost = (outputTokens * pricing.outputMicrousdPer1kTokens) / 1_000;
    return Math.ceil(inputCost + outputCost);
}
//# sourceMappingURL=deterministic-score.js.map