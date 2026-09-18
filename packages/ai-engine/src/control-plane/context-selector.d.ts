import type { ContextItem, ContextSelectionPolicy, ContextSelectionResult } from "./types.js";
export declare class ContextSelector {
    private readonly policy;
    constructor(policy?: Partial<ContextSelectionPolicy>);
    select(items: readonly ContextItem[], policyOverride?: Partial<ContextSelectionPolicy>): ContextSelectionResult;
}
//# sourceMappingURL=context-selector.d.ts.map