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

/** Security boundary: implementations must execute untrusted code in an isolated worker/container. */
export interface ExecutionRuntime { execute(request: ExecutionRequest): Promise<ExecutionResult>; }

export { DEFAULT_SANDBOX_POLICY, HardenedExecutionRuntime } from "./sandbox.js";
export type { IsolatedSandboxRunner, SandboxPolicy } from "./sandbox.js";
export * from "./agent-state.js";
/** Public durable event-store exports: append-only SQLite persistence and replay. */
export { SqliteAgentEventStore, SqliteEventStoreFactory } from "./sqlite-event-store.js";

/** P5 certification touch: this backend package remains the durable execution boundary. */
