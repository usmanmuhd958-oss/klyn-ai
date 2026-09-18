import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ROUTING_WEIGHTS,
  calculateRouteScore,
  compareRouteCandidates,
  decideRoute,
  estimateCostMicrousd,
  rankRouteCandidates,
  type ExecutionRequest,
  type ProviderCostMatrix,
  type RouteCandidate,
  type RouteCandidateInput,
  type RoutingPolicy,
} from "../src/index.js";

const policy: RoutingPolicy = {
  objective: "balanced",
  maxAttempts: 3,
  maxOutputTokens: 2_048,
  maxLatencyMs: 5_000,
  maxCostMicrousd: 10_000,
  weights: DEFAULT_ROUTING_WEIGHTS,
};

const request: ExecutionRequest = {
  requestId: "request-001",
  taskType: "code-generation",
  estimatedInputTokens: 1_000,
  estimatedOutputTokens: 500,
  policy,
};

function candidate(
  overrides: Partial<RouteCandidateInput> = {},
): RouteCandidateInput {
  return {
    candidateId: "candidate-001",
    provider: "openai",
    model: "model-a",
    qualityScoreBps: 8_000,
    reliabilityScoreBps: 9_000,
    latencyMs: 500,
    estimatedCostMicrousd: 1_000,
    ...overrides,
  };
}

test("routing score is deterministic for identical input", () => {
  const input = candidate();

  const first = calculateRouteScore(input, policy);
  const second = calculateRouteScore(input, policy);

  assert.equal(first, second);
});

test("routing weights must total exactly 10,000 basis points", () => {
  assert.throws(
    () =>
      calculateRouteScore(candidate(), {
        ...policy,
        weights: {
          qualityBps: 4_000,
          reliabilityBps: 2_500,
          latencyBps: 2_000,
          costBps: 1_499,
        },
      }),
    /must sum to 10000/,
  );
});

test("higher quality produces a higher score when other metrics are equal", () => {
  const lower = candidate({
    candidateId: "lower-quality",
    qualityScoreBps: 7_000,
  });

  const higher = candidate({
    candidateId: "higher-quality",
    qualityScoreBps: 9_000,
  });

  assert.ok(
    calculateRouteScore(higher, policy) >
      calculateRouteScore(lower, policy),
  );
});

test("policy cost limit excludes over-budget candidates", () => {
  const withinBudget = candidate({
    candidateId: "within-budget",
    estimatedCostMicrousd: 5_000,
  });

  const overBudget = candidate({
    candidateId: "over-budget",
    estimatedCostMicrousd: 10_001,
  });

  const decision = decideRoute(request, [
    withinBudget,
    overBudget,
  ]);

  assert.equal(
    decision.status,
    "selected",
  );

  assert.equal(
    decision.selectedCandidate?.candidateId,
    "within-budget",
  );

  assert.equal(
    decision.rankedCandidates.length,
    1,
  );
});

test("lexical tie-breaking is provider, then model, then candidate id", () => {
  const first: RouteCandidate = {
    ...candidate({
      candidateId: "zeta",
      provider: "anthropic",
      model: "model-a",
    }),
    scoreBps: 5_000,
  };

  const second: RouteCandidate = {
    ...candidate({
      candidateId: "alpha",
      provider: "openai",
      model: "model-a",
    }),
    scoreBps: 5_000,
  };

  assert.ok(
    compareRouteCandidates(first, second) < 0,
  );
});

test("ranking is stable even when candidates arrive in reverse order", () => {
  const candidates: readonly RouteCandidateInput[] = [
    candidate({
      candidateId: "candidate-z",
      provider: "openai",
      model: "model-z",
    }),
    candidate({
      candidateId: "candidate-a",
      provider: "openai",
      model: "model-a",
    }),
  ];

  const first = rankRouteCandidates(
    candidates,
    policy,
  );

  const second = rankRouteCandidates(
    [...candidates].reverse(),
    policy,
  );

  assert.deepEqual(
    first,
    second,
  );
});

test("route decision selects the top deterministic candidate", () => {
  const decision = decideRoute(request, [
    candidate({
      candidateId: "slow",
      latencyMs: 4_000,
    }),
    candidate({
      candidateId: "fast",
      latencyMs: 250,
    }),
  ]);

  assert.equal(
    decision.status,
    "selected",
  );

  assert.equal(
    decision.selectedCandidate?.candidateId,
    "fast",
  );
});

test("empty eligible set does not fabricate a route", () => {
  const decision = decideRoute(request, [
    candidate({
      candidateId: "too-expensive",
      estimatedCostMicrousd: 10_001,
    }),
  ]);

  assert.equal(
    decision.status,
    "no-eligible-candidate",
  );

  assert.equal(
    decision.selectedCandidate,
    null,
  );

  assert.equal(
    decision.rankedCandidates.length,
    0,
  );
});

test("provider cost matrix produces a deterministic integer estimate", () => {
  const matrix: ProviderCostMatrix = {
    entries: [
      {
        provider: "openai",
        model: "model-a",
        inputMicrousdPer1kTokens: 100,
        outputMicrousdPer1kTokens: 300,
      },
    ],
  };

  const estimated = estimateCostMicrousd(
    matrix,
    "openai",
    "model-a",
    1_250,
    750,
  );

  assert.equal(
    estimated,
    350,
  );
});
