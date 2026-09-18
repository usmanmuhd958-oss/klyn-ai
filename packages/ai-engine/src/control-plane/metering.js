function validateTokenCount(name, value) {
    if (value === undefined)
        return undefined;
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${name} must be a non-negative safe integer`);
    return value;
}
function costMicrousd(tokens, microusdPer1kTokens) {
    if (!Number.isFinite(microusdPer1kTokens) || microusdPer1kTokens < 0)
        throw new Error("pricing must be a non-negative finite number");
    const value = (tokens * microusdPer1kTokens) / 1000;
    if (!Number.isSafeInteger(Math.round(value)))
        throw new Error("computed token cost exceeds safe integer range");
    return Math.round(value);
}
export class TokenCostMeter {
    records = [];
    totalCostMicrousd = 0;
    totalInputTokens = 0;
    totalOutputTokens = 0;
    record(provider, inputTokens, outputTokens, recordedAt = Date.now()) {
        const input = validateTokenCount("inputTokens", inputTokens);
        const output = validateTokenCount("outputTokens", outputTokens);
        const status = input !== undefined && output !== undefined ? "complete" : "partial";
        const cost = input !== undefined && output !== undefined
            ? costMicrousd(input, provider.definition.pricing.inputMicrousdPer1kTokens) + costMicrousd(output, provider.definition.pricing.outputMicrousdPer1kTokens)
            : undefined;
        const record = Object.freeze({
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
        if (input !== undefined)
            this.totalInputTokens += input;
        if (output !== undefined)
            this.totalOutputTokens += output;
        if (cost !== undefined)
            this.totalCostMicrousd += cost;
        return record;
    }
    snapshot() {
        return [...this.records];
    }
    totals() {
        return Object.freeze({ inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens, costMicrousd: this.totalCostMicrousd });
    }
}
//# sourceMappingURL=metering.js.map