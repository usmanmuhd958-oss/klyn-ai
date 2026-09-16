import type { ExecutionRequest, ExecutionResult, ExecutionRuntime } from "./index.js";

export interface SandboxPolicy {
  maxTimeoutMs: number;
  maxMemoryMb: number;
  maxSourceBytes: number;
  allowedLanguages: ReadonlySet<ExecutionRequest["language"]>;
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  maxTimeoutMs: 30_000,
  maxMemoryMb: 512,
  maxSourceBytes: 1_000_000,
  allowedLanguages: new Set(["javascript", "typescript", "python", "rust"]),
};

export class HardenedExecutionRuntime implements ExecutionRuntime {
  constructor(private readonly runner: ExecutionRuntime, private readonly policy: SandboxPolicy = DEFAULT_SANDBOX_POLICY) {}

  execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.validate(request);
    return this.runner.execute({
      ...request,
      timeoutMs: Math.min(request.timeoutMs ?? this.policy.maxTimeoutMs, this.policy.maxTimeoutMs),
      memoryMb: Math.min(request.memoryMb ?? this.policy.maxMemoryMb, this.policy.maxMemoryMb),
    });
  }

  private validate(request: ExecutionRequest): void {
    if (!this.policy.allowedLanguages.has(request.language)) throw new Error(`Language is not permitted: ${request.language}`);
    if (!Number.isInteger(request.timeoutMs ?? this.policy.maxTimeoutMs) || (request.timeoutMs ?? this.policy.maxTimeoutMs) <= 0) throw new Error("timeoutMs must be a positive integer");
    if (!Number.isInteger(request.memoryMb ?? this.policy.maxMemoryMb) || (request.memoryMb ?? this.policy.maxMemoryMb) <= 0) throw new Error("memoryMb must be a positive integer");
    const bytes = Buffer.byteLength(request.source, "utf8");
    if (bytes > this.policy.maxSourceBytes) throw new Error("Source exceeds sandbox size limit");
  }
}

/**
 * Implementations should map this contract to a real OS/container boundary
 * (for example a separately isolated worker/container with a read-only root,
 * dropped privileges, seccomp/AppArmor, network policy and cgroup limits).
 * Never implement this interface with child_process.exec on the host.
 */
export type IsolatedSandboxRunner = ExecutionRuntime;
