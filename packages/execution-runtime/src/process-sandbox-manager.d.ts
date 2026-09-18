import { SecretMasker } from "./secret-masker.js";
export interface ProcessSandboxRequest {
    command: string;
    args?: readonly string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
    allowedEnv?: readonly string[];
    timeoutMs?: number;
    memoryMb?: number;
    maxCpuMs?: number;
    maxFileDescriptors?: number;
    maxOutputBytes?: number;
    fenceKey?: string;
    ownerId?: string;
}
export interface ProcessSandboxResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
    memoryExceeded: boolean;
}
export interface ProcessSandboxPolicy {
    maxTimeoutMs: number;
    maxMemoryMb: number;
    maxOutputBytes: number;
    maxCpuMs?: number;
    maxFileDescriptors?: number;
    allowedCommands: ReadonlySet<string>;
}
export declare const DEFAULT_PROCESS_SANDBOX_POLICY: ProcessSandboxPolicy;
/**
 * Host-process safety boundary. This is deliberately not a container escape
 * boundary: production deployments must place the manager inside an OS/container
 * sandbox with dropped privileges, seccomp/AppArmor, filesystem and network policy.
 */
export declare class ProcessSandboxManager {
    private readonly policy;
    private readonly secretMasker;
    private readonly owners;
    constructor(policy?: ProcessSandboxPolicy, secretMasker?: SecretMasker);
    execute(request: ProcessSandboxRequest): Promise<ProcessSandboxResult>;
    acquireFence(key: string, ownerId: string): boolean;
    releaseFence(key: string, ownerId: string): boolean;
    private validate;
    private terminate;
    private readResidentMemoryBytes;
    private readCpuTimeMs;
    private readFileDescriptorCount;
}
//# sourceMappingURL=process-sandbox-manager.d.ts.map