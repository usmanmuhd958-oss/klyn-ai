import type { ProcessSandboxRequest } from "./process-sandbox-manager.js";
import type { ResourceBoundaryPolicy, ResourceBoundaryRequest } from "./resource-boundary-enforcer.js";
export interface IntentResourceBudget {
    readonly maxCpuMillis: number;
    readonly maxMemoryBytes: number;
    readonly maxWallClockMillis: number;
    readonly maxConcurrentTasks: number;
    readonly maxNetworkRequests: number;
    readonly maxArtifactBytes: number;
}
export interface SandboxFilesystemAccess {
    readonly path: string;
    readonly mode: "read" | "write";
}
export interface SandboxPolicyCeilings {
    readonly maxCpuMillis: number;
    readonly maxMemoryBytes: number;
    readonly maxWallClockMillis: number;
    readonly maxFileDescriptors: number;
    readonly maxChildProcesses: number;
    readonly maxNetworkRequests: number;
    readonly maxArtifactBytes: number;
    readonly maxConcurrentTasks: number;
    readonly maxOutputBytes: number;
    readonly allowedCommands: ReadonlySet<string>;
    readonly allowedNetworkHosts: ReadonlySet<string>;
}
export interface SandboxPolicyContext {
    readonly workspace: string;
    readonly readRoots?: readonly string[];
    readonly writeRoots?: readonly string[];
}
export interface GovernedSandboxPolicy {
    readonly workspace: string;
    readonly maxCpuMillis: number;
    readonly maxMemoryBytes: number;
    readonly maxMemoryMb: number;
    readonly maxWallClockMillis: number;
    readonly maxFileDescriptors: number;
    readonly maxChildProcesses: number;
    readonly maxNetworkRequests: number;
    readonly maxArtifactBytes: number;
    readonly maxConcurrentTasks: number;
    readonly maxOutputBytes: number;
    readonly allowedCommands: ReadonlySet<string>;
    readonly allowedNetworkHosts: ReadonlySet<string>;
    readonly readRoots: readonly string[];
    readonly writeRoots: readonly string[];
}
export interface SandboxPolicyRequest {
    readonly resourceBudget: IntentResourceBudget;
    readonly timeoutMs?: number;
    readonly memoryBytes?: number;
    readonly cpuMillis?: number;
    readonly fileDescriptors?: number;
    readonly childProcesses?: number;
    readonly networkRequests?: number;
    readonly artifactBytes?: number;
    readonly filesystemAccess?: readonly SandboxFilesystemAccess[];
    readonly networkHosts?: readonly string[];
}
export type SandboxViolationCode = "INVALID_BUDGET" | "MEMORY_LIMIT" | "CPU_LIMIT" | "TIMEOUT_LIMIT" | "FILE_DESCRIPTOR_LIMIT" | "CHILD_PROCESS_LIMIT" | "NETWORK_REQUEST_LIMIT" | "NETWORK_HOST_DENIED" | "FILESYSTEM_PATH_DENIED" | "ARTIFACT_LIMIT";
export declare class SandboxPolicyViolation extends Error {
    readonly code: SandboxViolationCode;
    constructor(code: SandboxViolationCode, message: string);
}
export declare const DEFAULT_SANDBOX_POLICY_CEILINGS: SandboxPolicyCeilings;
export declare class SandboxPolicyEngine {
    private readonly ceilings;
    constructor(ceilings?: SandboxPolicyCeilings);
    translate(resourceBudget: IntentResourceBudget, context: SandboxPolicyContext): GovernedSandboxPolicy;
    validateRequest(policy: GovernedSandboxPolicy, request: SandboxPolicyRequest): void;
    toProcessSandboxRequest(policy: GovernedSandboxPolicy, request: SandboxPolicyRequest, process: Omit<ProcessSandboxRequest, "cwd" | "timeoutMs" | "memoryMb" | "maxCpuMs" | "maxFileDescriptors" | "maxOutputBytes">): ProcessSandboxRequest;
    toResourceBoundaryPolicy(policy: GovernedSandboxPolicy): ResourceBoundaryPolicy;
    toResourceBoundaryRequest(policy: GovernedSandboxPolicy, request: SandboxPolicyRequest): ResourceBoundaryRequest;
    private validateBudget;
    private assertBudgetCeilings;
    private validateWorkspace;
}
//# sourceMappingURL=SandboxPolicyEngine.d.ts.map