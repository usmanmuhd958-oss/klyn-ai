export interface ExecutionRequest {
  language: "javascript" | "typescript" | "python" | "rust";
  source: string;
  timeoutMs?: number;
  memoryMb?: number;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Security boundary: implementations must execute untrusted code in an
 * isolated worker/container. This package intentionally exposes no host-shell
 * primitive to callers.
 */
export interface ExecutionRuntime {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export { DEFAULT_SANDBOX_POLICY, HardenedExecutionRuntime } from "./sandbox.js";
export type { IsolatedSandboxRunner, SandboxPolicy } from "./sandbox.js";
