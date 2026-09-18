export const TASK_TYPES = [
    "code-generation",
    "code-review",
    "refactoring",
    "debugging",
    "planning",
    "reasoning",
    "analysis",
    "general",
];
export const DEFAULT_ROUTING_WEIGHTS = Object.freeze({
    qualityBps: 4_000,
    reliabilityBps: 2_500,
    latencyBps: 2_000,
    costBps: 1_500,
});
export const DEFAULT_MAX_LATENCY_MS = 10_000;
export const ROUTING_SCORE_BPS = 10_000;
//# sourceMappingURL=contracts.js.map