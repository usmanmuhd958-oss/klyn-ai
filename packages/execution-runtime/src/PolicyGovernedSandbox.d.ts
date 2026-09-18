import { ProcessSandboxManager, type ProcessSandboxResult } from "./process-sandbox-manager.js";
import { ResourceBoundaryEnforcer } from "./resource-boundary-enforcer.js";
import { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";
import { SandboxPolicyEngine, type IntentResourceBudget, type SandboxFilesystemAccess, type GovernedSandboxPolicy, type SandboxPolicyCeilings } from "./SandboxPolicyEngine.js";
import { ObservationCollector, type ObservationEvent } from "./ObservationCollector.js";
export interface PolicyGovernedSandboxRequest {
    readonly intentId: string;
    readonly taskId: string;
    readonly agentId: string;
    readonly resourceBudget: IntentResourceBudget;
    readonly cwd: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
    readonly allowedEnv?: readonly string[];
    readonly timeoutMs?: number;
    readonly memoryBytes?: number;
    readonly cpuMillis?: number;
    readonly fileDescriptors?: number;
    readonly childProcesses?: number;
    readonly networkRequests?: number;
    readonly artifactBytes?: number;
    readonly filesystemAccess?: readonly SandboxFilesystemAccess[];
    readonly networkHosts?: readonly string[];
    readonly fenceKey?: string;
    readonly ownerId?: string;
    readonly rollbackOnNonZeroExit?: boolean;
}
export interface PolicyGovernedSandboxResult {
    readonly process: ProcessSandboxResult;
    readonly policy: GovernedSandboxPolicy;
    readonly rolledBack: boolean;
    readonly rollbackReason?: string;
    readonly events: readonly ObservationEvent[];
    readonly eventStreamHash: string;
}
export interface PolicyGovernedSandboxOptions {
    readonly policyEngine?: SandboxPolicyEngine;
    readonly processManager?: ProcessSandboxManager;
    readonly snapshotEngine?: RuntimeSnapshotEngine;
    readonly resourceBoundary?: ResourceBoundaryEnforcer;
    readonly observationCollector?: ObservationCollector;
    readonly policyContext?: {
        readonly readRoots?: readonly string[];
        readonly writeRoots?: readonly string[];
        readonly ceilings?: SandboxPolicyCeilings;
    };
}
export declare class PolicyGovernedSandbox {
    private readonly policyEngine;
    private readonly processManager;
    private readonly snapshots;
    private readonly resourceBoundary;
    private readonly defaultCollector;
    private readonly readRoots;
    private readonly writeRoots;
    constructor(options?: PolicyGovernedSandboxOptions);
    execute(request: PolicyGovernedSandboxRequest): Promise<PolicyGovernedSandboxResult>;
}
//# sourceMappingURL=PolicyGovernedSandbox.d.ts.map