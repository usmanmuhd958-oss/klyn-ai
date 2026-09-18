export interface ResourceBoundaryPolicy {
    readonly maxMemoryMb: number;
    readonly maxCpuMs: number;
    readonly maxFileDescriptors: number;
    readonly maxExecutionMs: number;
    readonly authorizedWorkspaces: readonly string[];
}
export interface ResourceBoundaryRequest {
    readonly cwd: string;
    readonly timeoutMs?: number;
    readonly memoryMb?: number;
}
export declare const DEFAULT_RESOURCE_BOUNDARY_POLICY: ResourceBoundaryPolicy;
export declare class ResourceBoundaryViolation extends Error {
    constructor(message: string);
}
export declare class ResourceBoundaryEnforcer {
    private readonly policy;
    constructor(policy?: ResourceBoundaryPolicy);
    validate(request: ResourceBoundaryRequest): string;
    authorizedWorkspace(cwd: string): string;
    assertRuntimeLimits(timeoutMs: number, memoryMb: number): void;
}
//# sourceMappingURL=resource-boundary-enforcer.d.ts.map