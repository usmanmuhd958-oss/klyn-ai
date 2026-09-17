import type { AiEngineProvider, TokenMeterRecord } from "./types.js";

function validateTokenCount(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function costMicrousd(tokens: number, microusdPer1kTokens: number): number {
  if (!Number.isFinite(microusdPer1kTokens) || microusdPer1kTokens < 0) throw new Error("pricing must be a non-negative finite number");
  const value = (tokens * microusdPer1kTokens) / 1000;
  if (!Number.isSafeInteger(Math.round(value))) throw new Error("computed token cost exceeds safe integer range");
  return Math.round(value);
}

export class TokenCostMeter {
  private readonly records: TokenMeterRecord[] = [];
  private totalCostMicrousd = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  record(provider: AiEngineProvider, inputTokens?: number, outputTokens?: number, recordedAt = Date.now()): TokenMeterRecord {
    const input = validateTokenCount("inputTokens", inputTokens);
    const output = validateTokenCount("outputTokens", outputTokens);
    const status = input !== undefined && output !== undefined ? "complete" : "partial";
    const cost = input !== undefined && output !== undefined
      ? costMicrousd(input, provider.definition.pricing.inputMicrousdPer1kTokens) + costMicrousd(output, provider.definition.pricing.outputMicrousdPer1kTokens)
      : undefined;
    const record: TokenMeterRecord = Object.freeze({
      providerId: provider.id,
      provider: provider.definition.provider,
      model: provider.definition.model,
      inputTokens: input,
      outputTokens: output,
      costMicrousd: cost,
      status,
      recordedAt,
    });
    this.records.push(record);
    if (input !== undefined) this.totalInputTokens += input;
    if (output !== undefined) this.totalOutputTokens += output;
    if (cost !== undefined) this.totalCostMicrousd += cost;
    return record;
  }

  snapshot(): readonly TokenMeterRecord[] {
    return [...this.records];
  }

  totals(): { readonly inputTokens: number; readonly outputTokens: number; readonly costMicrousd: number } {
    return Object.freeze({ inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens, costMicrousd: this.totalCostMicrousd });
  }
}
