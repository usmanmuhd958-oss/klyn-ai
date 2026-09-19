import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DynamicProviderRouter, type DynamicProviderCandidate } from "../src/index.ts";
import type { ProviderAdapter } from "../src/providers/types.js";

function adapter(name: ProviderAdapter["name"], output: string, fail = false): ProviderAdapter {
  return {
    name,
    async generate(request) {
      if (fail) throw new Error("provider unavailable");
      return {
        provider: name,
        model: request.model,
        output,
      };
    },
    async *stream() {
      yield { provider: name, model: "test", text: output, done: true };
    },
  };
}

test("dynamic router selects eligible candidates and records health", async () => {
  const candidates: DynamicProviderCandidate[] = [
    {
      provider: "openai",
      model: "model-a",
      adapter: adapter("openai", "A"),
      qualityScore: 0.9,
      inputCostMicrousdPer1K: 1,
      outputCostMicrousdPer1K: 1,
      capabilities: ["code"],
    },
    {
      provider: "anthropic",
      model: "model-b",
      adapter: adapter("anthropic", "B"),
      qualityScore: 0.7,
      inputCostMicrousdPer1K: 2,
      outputCostMicrousdPer1K: 2,
      capabilities: ["code"],
    },
  ];

  const router = new DynamicProviderRouter({ candidates });
  const decision = router.route(
    { input: "write code", maxOutputTokens: 100 },
    { requiredCapabilities: ["code"], objective: "quality" },
  );
  assert.equal(decision.provider, "openai");

  const response = await router.generate(
    { input: "write code", maxOutputTokens: 100 },
    { requiredCapabilities: ["code"], objective: "quality" },
  );
  assert.equal(response.output, "A");
  assert.equal(router.healthSnapshot()[0]?.successes, 1);
});

test("dynamic router fails over after an unhealthy candidate", async () => {
  const candidates: DynamicProviderCandidate[] = [
    {
      provider: "openai",
      model: "broken",
      adapter: adapter("openai", "broken", true),
      qualityScore: 1,
      capabilities: ["code"],
    },
    {
      provider: "anthropic",
      model: "healthy",
      adapter: adapter("anthropic", "healthy"),
      qualityScore: 0.5,
      capabilities: ["code"],
    },
  ];

  const router = new DynamicProviderRouter({ candidates });
  const response = await router.generate(
    { input: "write code" },
    { requiredCapabilities: ["code"], maxCandidates: 2 },
  );
  assert.equal(response.output, "healthy");
  assert.equal(router.healthSnapshot()[0]?.failures, 1);
});
