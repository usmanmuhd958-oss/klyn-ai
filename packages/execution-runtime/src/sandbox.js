export const DEFAULT_SANDBOX_POLICY = {
    maxTimeoutMs: 30_000,
    maxMemoryMb: 512,
    maxSourceBytes: 1_000_000,
    allowedLanguages: new Set(["javascript", "typescript", "python", "rust"]),
};
export class HardenedExecutionRuntime {
    runner;
    policy;
    constructor(runner, policy = DEFAULT_SANDBOX_POLICY) {
        this.runner = runner;
        this.policy = policy;
    }
    execute(request) {
        this.validate(request);
        return this.runner.execute({
            ...request,
            timeoutMs: Math.min(request.timeoutMs ?? this.policy.maxTimeoutMs, this.policy.maxTimeoutMs),
            memoryMb: Math.min(request.memoryMb ?? this.policy.maxMemoryMb, this.policy.maxMemoryMb),
        });
    }
    validate(request) {
        if (!this.policy.allowedLanguages.has(request.language))
            throw new Error(`Language is not permitted: ${request.language}`);
        if (!Number.isInteger(request.timeoutMs ?? this.policy.maxTimeoutMs) || (request.timeoutMs ?? this.policy.maxTimeoutMs) <= 0)
            throw new Error("timeoutMs must be a positive integer");
        if (!Number.isInteger(request.memoryMb ?? this.policy.maxMemoryMb) || (request.memoryMb ?? this.policy.maxMemoryMb) <= 0)
            throw new Error("memoryMb must be a positive integer");
        const bytes = Buffer.byteLength(request.source, "utf8");
        if (bytes > this.policy.maxSourceBytes)
            throw new Error("Source exceeds sandbox size limit");
    }
}
//# sourceMappingURL=sandbox.js.map