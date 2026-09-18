import {
  RealTimeContainmentInterceptor,
  type BudgetLedger,
  type ContainmentDecision,
  type UsageMetrics,
} from "@klyn/autonomy";
import type {
  ProviderAdapter,
  ProviderResponse,
  ProviderUsage,
  StreamChunk,
} from "./providers/types.js";
import type { AiEngineProvider } from "./control-plane/types.js";

const USD_CENTS_PER_USD = 100n;
const MICRO_USD_PER_USD = 1_000_000n;
const MICRO_USD_PER_CENT = MICRO_USD_PER_USD / USD_CENTS_PER_USD;

export interface AutonomyBudgetFeedOptions {
  readonly ledger: BudgetLedger;
  readonly onDecision?: (decision: ContainmentDecision) => void | Promise<void>;
}

function validateTokenCount(value: number | undefined, field: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(field + " must be a non-negative safe integer");
  }
  return value;
}

function costMicrousd(
  usage: ProviderUsage | undefined,
  provider: AiEngineProvider,
): number {
  const input = validateTokenCount(usage?.inputTokens, "inputTokens");
  const output = validateTokenCount(usage?.outputTokens, "outputTokens");
  if (input === 0 && output === 0) return 0;

  const inputRate = provider.definition.pricing.inputMicrousdPer1kTokens;
  const outputRate = provider.definition.pricing.outputMicrousdPer1kTokens;

  if (!Number.isFinite(inputRate) || inputRate < 0) throw new RangeError("input provider pricing is invalid");
  if (!Number.isFinite(outputRate) || outputRate < 0) throw new RangeError("output provider pricing is invalid");

  const total = (input * inputRate + output * outputRate) / 1000;
  if (!Number.isSafeInteger(Math.round(total))) {
    throw new RangeError("computed provider cost exceeds safe integer range");
  }
  return Math.round(total);
}

function microusdToUsdCents(microusd: number): bigint {
  if (!Number.isSafeInteger(microusd) || microusd < 0) {
    throw new RangeError("micro-USD cost must be a non-negative safe integer");
  }
  const value = BigInt(microusd);
  return (value + MICRO_USD_PER_CENT - 1n) / MICRO_USD_PER_CENT;
}

function usageToMetrics(
  usage: ProviderUsage | undefined,
  provider: AiEngineProvider,
): UsageMetrics | undefined {
  if (!usage) return undefined;

  const inputTokens = validateTokenCount(usage.inputTokens, "inputTokens");
  const outputTokens = validateTokenCount(usage.outputTokens, "outputTokens");
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return undefined;

  return Object.freeze({
    tokens: inputTokens + outputTokens,
    computeMillis: 0,
    networkRequests: 0,
    financialSpendMinorUnits: microusdToUsdCents(costMicrousd(usage, provider)),
    toolInvocations: 0,
    wallClockMillis: 0,
  });
}

class BudgetAwareProviderAdapter implements ProviderAdapter {
  public readonly name: ProviderAdapter["name"];

  public constructor(
    private readonly inner: ProviderAdapter,
    private readonly provider: AiEngineProvider,
    private readonly interceptor: RealTimeContainmentInterceptor,
  ) {
    this.name = inner.name;
  }

  public async generate(request: Parameters<ProviderAdapter["generate"]>[0]): Promise<ProviderResponse> {
    const response = await this.inner.generate(request);
    const delta = usageToMetrics(response.usage, this.provider);
    if (delta) await this.interceptor.intercept(delta);
    return response;
  }

  public async *stream(request: Parameters<ProviderAdapter["stream"]>[0]): AsyncIterable<StreamChunk> {
    let finalUsage: ProviderUsage | undefined;
    for await (const chunk of this.inner.stream(request)) {
      if (chunk.usage) finalUsage = chunk.usage;
      yield chunk;
    }

    const delta = usageToMetrics(finalUsage, this.provider);
    if (delta) await this.interceptor.intercept(delta);
  }
}

export class AutonomyBudgetFeed {
  private readonly interceptor: RealTimeContainmentInterceptor;

  public constructor(options: AutonomyBudgetFeedOptions) {
    this.interceptor = new RealTimeContainmentInterceptor(options.ledger, {
      onDecision: async (decision) => {
        this.decisions.push(decision);
        await options.onDecision?.(decision);
      },
    });
  }

  public isTerminated(): boolean {
    return this.interceptor.isTerminated();
  }

  public recentDecisions(): readonly ContainmentDecision[] {
    return Object.freeze([...this.decisions]);
  }

  public wrap(provider: AiEngineProvider): AiEngineProvider {
    return Object.freeze({
      ...provider,
      adapter: new BudgetAwareProviderAdapter(provider.adapter, provider, this.interceptor),
    });
  }

  private readonly decisions: ContainmentDecision[] = [];

  public async record(
    provider: AiEngineProvider,
    usage: ProviderUsage,
    nowEpochMs = Date.now(),
  ): Promise<ContainmentDecision | undefined> {
    const delta = usageToMetrics(usage, provider);
    if (!delta) return undefined;
    const decision = await this.interceptor.intercept(delta, nowEpochMs);
    this.decisions.push(decision);
    return decision;
  }
}

