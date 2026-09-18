import type { ExecutionRequest, ExecutionResult, ExecutionRuntime } from "./index.js";
export interface SandboxPolicy {
    maxTimeoutMs: number;
    maxMemoryMb: number;
    maxSourceBytes: number;
    allowedLanguages: ReadonlySet<ExecutionRequest["language"]>;
}
export declare const DEFAULT_SANDBOX_POLICY: SandboxPolicy;
export declare class HardenedExecutionRuntime implements ExecutionRuntime {
    private readonly runner;
    private readonly policy;
    constructor(runner: ExecutionRuntime, policy?: SandboxPolicy);
    execute(request: ExecutionRequest): Promise<ExecutionResult>;
    private validate;
}
/**
 * Implementations should map this contract to a real OS/container boundary
 * (for example a separately isolated worker/container with a read-only root,
 * dropped privileges, seccomp/AppArmor, network policy and cgroup limits).
 * Never implement this interface with child_process.exec on the host.
 */
export type IsolatedSandboxRunner = ExecutionRuntime;
//# sourceMappingURL=sandbox.d.ts.map