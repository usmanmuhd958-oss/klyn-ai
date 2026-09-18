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
export interface ExecutionRuntime {
    execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
export { DEFAULT_SANDBOX_POLICY, HardenedExecutionRuntime } from "./sandbox.js";
export type { IsolatedSandboxRunner, SandboxPolicy } from "./sandbox.js";
export * from "./agent-state.js";
export { SqliteAgentEventStore, SqliteEventStoreFactory } from "./sqlite-event-store.js";
export type { DurableTask, EnqueueTaskInput, TaskStatus } from "./sqlite-event-store.js";
export { LeaseScheduler, WorkerHeartbeat, LeaseReaper } from "./lease-scheduler.js";
export type { HeartbeatRequest, LeaseSchedulerOptions } from "./lease-scheduler.js";
export { ProcessSandboxManager, DEFAULT_PROCESS_SANDBOX_POLICY } from "./process-sandbox-manager.js";
export type { ProcessSandboxPolicy, ProcessSandboxRequest, ProcessSandboxResult } from "./process-sandbox-manager.js";
export { SecretMasker } from "./secret-masker.js";
export type { SecretMaskerOptions } from "./secret-masker.js";
export { DependencyExecutionPlanner } from "./dependency-execution-planner.js";
export type { PlannedTask, DependencyPlanResult } from "./dependency-execution-planner.js";
export { ResourceBoundaryEnforcer, ResourceBoundaryViolation, DEFAULT_RESOURCE_BOUNDARY_POLICY } from "./resource-boundary-enforcer.js";
export type { ResourceBoundaryPolicy, ResourceBoundaryRequest } from "./resource-boundary-enforcer.js";
export { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";
export type { RuntimeSnapshot } from "./runtime-snapshot-engine.js";
export { EphemeralSandboxRuntime } from "./ephemeral-sandbox-runtime.js";
export type { EphemeralSandboxRequest, EphemeralSandboxRuntimeOptions } from "./ephemeral-sandbox-runtime.js";
export { SandboxPolicyEngine, DEFAULT_SANDBOX_POLICY_CEILINGS, SandboxPolicyViolation } from "./SandboxPolicyEngine.js";
export type { GovernedSandboxPolicy, IntentResourceBudget, SandboxFilesystemAccess, SandboxPolicyCeilings, SandboxPolicyContext, SandboxPolicyRequest, SandboxViolationCode } from "./SandboxPolicyEngine.js";
export { PolicyGovernedSandbox } from "./PolicyGovernedSandbox.js";
export type { PolicyGovernedSandboxRequest, PolicyGovernedSandboxResult, PolicyGovernedSandboxOptions } from "./PolicyGovernedSandbox.js";
export { ObservationCollector, SYSTEM_CLOCK } from "./ObservationCollector.js";
export type { ObservationClock, ObservationEvent, ObservationEventInput, ObservationEventType, ObservationSessionMetadata, ObservationSnapshot } from "./ObservationCollector.js";
//# sourceMappingURL=index.d.ts.map