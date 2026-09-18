import { type ResourceBoundaryPolicy } from "./resource-boundary-enforcer.js";
import { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";
import { type ProcessSandboxPolicy, type ProcessSandboxResult } from "./process-sandbox-manager.js";
export interface EphemeralSandboxRequest {
    readonly command: string;
    readonly args?: readonly string[];
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly allowedEnv?: readonly string[];
    readonly timeoutMs?: number;
    readonly memoryMb?: number;
    readonly maxCpuMs?: number;
    readonly maxFileDescriptors?: number;
    readonly maxOutputBytes?: number;
    readonly fenceKey?: string;
    readonly ownerId?: string;
}
export interface EphemeralSandboxRuntimeOptions {
    readonly processPolicy?: ProcessSandboxPolicy;
    readonly resourcePolicy?: ResourceBoundaryPolicy;
    readonly snapshotEngine?: RuntimeSnapshotEngine;
}
export declare class EphemeralSandboxRuntime {
    private readonly enforcer;
    private readonly processSandbox;
    private readonly snapshots;
    constructor(options?: EphemeralSandboxRuntimeOptions);
    execute(request: EphemeralSandboxRequest): Promise<ProcessSandboxResult>;
}
//# sourceMappingURL=ephemeral-sandbox-runtime.d.ts.map