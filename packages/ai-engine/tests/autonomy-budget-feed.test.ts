import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AutonomyBudgetFeed,
  AiEngine,
  type AiEngineProvider,
} from "../src/index.js";
import {
  BudgetLedger,
  AutonomyContainmentError,
} from "@klyn/autonomy";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
} from "../src/providers/types.js";

function envelope() {
  return {
    schemaVersion: 1 as const,
    missionId: "mission-1",
    agentId: "agent-1",
    principalId: "principal-1",
    policyVersion: "policy-1",
    issuedAtEpochMs: 0,
    expiresAtEpochMs: 100_000,
    limits: {
      tokens: 100,
      computeMillis: 10_000,
      networkRequests: 100,
      financialSpendMinorUnits: 100n,
      toolInvocations: 100,
      wallClockMillis: 10_000,
    },
    warningThresholds: {
      tokens: 0.5,
      computeMillis: 0.5,
      networkRequests: 0.5,
      financialSpendMinorUnits: 0.5,
      toolInvocations: 0.5,
      wallClockMillis: 0.5,
    },
    escalationThresholds: {
      tokens: 0.9,
      computeMillis: 0.9,
      networkRequests: 0.9,
      financialSpendMinorUnits: 0.9,
      toolInvocations: 0.9,
      wallClockMillis: 0.9,
    },
    allowedTools: [],
    maxRisk: "low" as const,
    maxDelegationDepth: 0,
  };
}

function adapter(response: ProviderResponse): ProviderAdapter {
  return {
    name: response.provider,
    generate: async (_request: ProviderRequest) => response,
    async *stream(_request: ProviderRequest): AsyncIterable<StreamChunk> {
      yield { provider: response.provider, model: response.model, text: "streamed" };
      yield {
        provider: response.provider,
        model: response.model,
        text: "",
        done: true,
        usage: response.usage,
      };
    },
  };
}

function provider(response: ProviderResponse): AiEngineProvider {
  return {
    id: "provider-1",
    definition: {
      provider: response.provider,
      model: response.model,
      contextWindowTokens: 128_000,
      capabilities: new Set(),
      pricing: {
        inputMicrousdPer1kTokens: 1_000,
        outputMicrousdPer1kTokens: 2_000,
      },
    },
    adapter: adapter(response),
  };
}

test("AiEngine feeds normalized provider usage into the autonomy ledger", async () => {
  const response: ProviderResponse = {
    provider: "openai",
    model: "gpt-test",
    output: "ok",
    usage: { inputTokens: 20, outputTokens: 10 },
  };
  const budget = new BudgetLedger(envelope());
  const feed = new AutonomyBudgetFeed({ ledger: budget });
  const engine = new AiEngine([provider(response)], { autonomyBudgetFeed: feed });

  const result = await engine.complete({ input: "hello", model: "gpt-test" });
  assert.equal(result.response.usage?.inputTokens, 20);
  assert.equal(budget.snapshot().usage.tokens, 30);
  assert.equal(budget.snapshot().usage.financialSpendMinorUnits, 4n);
});

test("budget termination is not treated as provider failure or fallback", async () => {
  const response: ProviderResponse = {
    provider: "openai",
    model: "gpt-test",
    output: "ok",
    usage: { inputTokens: 80, outputTokens: 30 },
  };
  const budget = new BudgetLedger(envelope());
  const feed = new AutonomyBudgetFeed({ ledger: budget });
  const engine = new AiEngine([provider(response), {
    ...provider({ ...response, provider: "anthropic" }),
    id: "provider-2",
  }], { autonomyBudgetFeed: feed });

  await assert.rejects(
    engine.complete({ input: "hello", model: "gpt-test" }),
    (error: unknown) => error instanceof AutonomyContainmentError,
  );
  assert.equal(budget.isTerminated(), true);
});
