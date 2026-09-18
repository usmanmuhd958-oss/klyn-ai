import { ProviderHealthTracker } from "./health.js";
import { TokenCostMeter } from "./metering.js";
import { type AiCompletionRequest, type AiCompletionResult, type AiEngineProvider, type ProviderHealthSnapshot, type RoutingPolicy } from "./types.js";
export interface AiEngineOptions {
    readonly routing?: Partial<RoutingPolicy>;
    readonly health?: Partial<ConstructorParameters<typeof ProviderHealthTracker>[0]>;
    readonly meter?: TokenCostMeter;
    readonly requestTimeoutMs?: number;
}
export declare class AiEngine {
    readonly health: ProviderHealthTracker;
    readonly meter: TokenCostMeter;
    private readonly providers;
    private readonly routing;
    private readonly contextSelector;
    private readonly requestTimeoutMs;
    constructor(providers: readonly AiEngineProvider[], options?: AiEngineOptions);
    complete(request: AiCompletionRequest, routingOverride?: Partial<RoutingPolicy>): Promise<AiCompletionResult>;
    healthSnapshot(): readonly ProviderHealthSnapshot[];
    private selectContext;
    private selectCandidates;
}
//# sourceMappingURL=engine.d.ts.map