import test from "node:test";
import assert from "node:assert/strict";
import { ProviderCircuitBreaker } from "../src/circuit-breaker.js";

test("opens after threshold and permits a half-open probe after cooldown", async () => {
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 2, cooldownMs: 10, baseBackoffMs: 1, maxBackoffMs: 2 });
  breaker.recordFailure("openai");
  breaker.recordFailure("openai");
  assert.equal(breaker.canRequest("openai"), false);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(breaker.canRequest("openai"), true);
  breaker.recordSuccess("openai");
  assert.equal(breaker.canRequest("openai"), true);
});
