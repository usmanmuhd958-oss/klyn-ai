import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProcessSandboxPolicy, ProcessSandboxRequest } from "./process-sandbox-manager.js";
import type { ResourceBoundaryPolicy, ResourceBoundaryRequest } from "./resource-boundary-enforcer.js";

const BYTES_PER_MIB = 1024 * 1024;

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

export type SandboxViolationCode =
  | "INVALID_BUDGET"
  | "MEMORY_LIMIT"
  | "CPU_LIMIT"
  | "TIMEOUT_LIMIT"
  | "FILE_DESCRIPTOR_LIMIT"
  | "CHILD_PROCESS_LIMIT"
  | "NETWORK_REQUEST_LIMIT"
  | "NETWORK_HOST_DENIED"
  | "FILESYSTEM_PATH_DENIED"
  | "ARTIFACT_LIMIT";

export class SandboxPolicyViolation extends Error {
  constructor(readonly code: SandboxViolationCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SandboxPolicyViolation";
  }
}

export const DEFAULT_SANDBOX_POLICY_CEILINGS: SandboxPolicyCeilings = {
  maxCpuMillis: 30_000,
  maxMemoryBytes: 512 * BYTES_PER_MIB,
  maxWallClockMillis: 30_000,
  maxFileDescriptors: 256,
  maxChildProcesses: 0,
  maxNetworkRequests: 0,
  maxArtifactBytes: 1_000_000,
  maxConcurrentTasks: 16,
  maxOutputBytes: 1_000_000,
  allowedCommands: new Set(["node", "python", "python3", "deno", "bun", "cargo", "rustc"]),
  allowedNetworkHosts: new Set(),
};

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new SandboxPolicyViolation("INVALID_BUDGET", `${field} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new SandboxPolicyViolation("INVALID_BUDGET", `${field} must be a positive integer`);
  }
}

function normalizeRoot(path: string): string {
  if (!isAbsolute(path)) throw new SandboxPolicyViolation("FILESYSTEM_PATH_DENIED", `Filesystem root must be absolute: ${path}`);
  return realpathSync(path);
}

function pathIsWithin(root: string, candidate: string): boolean {
  const resolved = resolve(candidate);
  const rel = relative(root, resolved);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class SandboxPolicyEngine {
  constructor(private readonly ceilings: SandboxPolicyCeilings = DEFAULT_SANDBOX_POLICY_CEILINGS) {}

  translate(resourceBudget: IntentResourceBudget, context: SandboxPolicyContext): GovernedSandboxPolicy {
    this.validateBudget(resourceBudget);
    const workspace = this.validateWorkspace(context.workspace);
    const readRoots = [...(context.readRoots ?? [workspace])].map(normalizeRoot).sort();
    const writeRoots = [...(context.writeRoots ?? [workspace])].map(normalizeRoot).sort();
    this.assertBudgetCeilings(resourceBudget);

    return Object.freeze({
      workspace,
      maxCpuMillis: resourceBudget.maxCpuMillis,
      maxMemoryBytes: resourceBudget.maxMemoryBytes,
      maxMemoryMb: Math.max(1, Math.ceil(resourceBudget.maxMemoryBytes / BYTES_PER_MIB)),
      maxWallClockMillis: resourceBudget.maxWallClockMillis,
      maxFileDescriptors: this.ceilings.maxFileDescriptors,
      maxChildProcesses: this.ceilings.maxChildProcesses,
      maxNetworkRequests: resourceBudget.maxNetworkRequests,
      maxArtifactBytes: resourceBudget.maxArtifactBytes,
      maxConcurrentTasks: resourceBudget.maxConcurrentTasks,
      maxOutputBytes: Math.min(this.ceilings.maxOutputBytes, resourceBudget.maxArtifactBytes),
      allowedCommands: this.ceilings.allowedCommands,
      allowedNetworkHosts: this.ceilings.allowedNetworkHosts,
      readRoots,
      writeRoots,
    });
  }

  validateRequest(policy: GovernedSandboxPolicy, request: SandboxPolicyRequest): void {
    const timeoutMs = request.timeoutMs ?? policy.maxWallClockMillis;
    const memoryBytes = request.memoryBytes ?? policy.maxMemoryBytes;
    const cpuMillis = request.cpuMillis ?? policy.maxCpuMillis;
    const fileDescriptors = request.fileDescriptors ?? policy.maxFileDescriptors;
    const childProcesses = request.childProcesses ?? 0;
    const networkRequests = request.networkRequests ?? 0;
    const artifactBytes = request.artifactBytes ?? 0;

    assertPositiveInteger(timeoutMs, "timeoutMs");
    assertPositiveInteger(memoryBytes, "memoryBytes");
    assertNonNegativeInteger(cpuMillis, "cpuMillis");
    assertPositiveInteger(fileDescriptors, "fileDescriptors");
    assertNonNegativeInteger(childProcesses, "childProcesses");
    assertNonNegativeInteger(networkRequests, "networkRequests");
    assertNonNegativeInteger(artifactBytes, "artifactBytes");

    if (timeoutMs > policy.maxWallClockMillis) throw new SandboxPolicyViolation("TIMEOUT_LIMIT", "Execution timeout exceeds the intent-derived policy");
    if (memoryBytes > policy.maxMemoryBytes) throw new SandboxPolicyViolation("MEMORY_LIMIT", "Memory allocation exceeds the intent-derived policy");
    if (cpuMillis > policy.maxCpuMillis) throw new SandboxPolicyViolation("CPU_LIMIT", "CPU allocation exceeds the intent-derived policy");
    if (fileDescriptors > policy.maxFileDescriptors) throw new SandboxPolicyViolation("FILE_DESCRIPTOR_LIMIT", "File descriptor allocation exceeds the runtime policy");
    if (childProcesses > policy.maxChildProcesses) throw new SandboxPolicyViolation("CHILD_PROCESS_LIMIT", "Child-process allocation exceeds the runtime policy");
    if (networkRequests > policy.maxNetworkRequests) throw new SandboxPolicyViolation("NETWORK_REQUEST_LIMIT", "Network request allocation exceeds the intent-derived policy");
    if (artifactBytes > policy.maxArtifactBytes) throw new SandboxPolicyViolation("ARTIFACT_LIMIT", "Artifact allocation exceeds the intent-derived policy");

    for (const access of request.filesystemAccess ?? []) {
      const roots = access.mode === "read" ? policy.readRoots : policy.writeRoots;
      if (!roots.some((root) => pathIsWithin(root, access.path))) {
        throw new SandboxPolicyViolation("FILESYSTEM_PATH_DENIED", `${access.mode} access denied: ${access.path}`);
      }
    }

    for (const host of request.networkHosts ?? []) {
      if (!policy.allowedNetworkHosts.has(host)) {
        throw new SandboxPolicyViolation("NETWORK_HOST_DENIED", `Network host denied: ${host}`);
      }
    }
  }

  toProcessSandboxRequest(
    policy: GovernedSandboxPolicy,
    request: SandboxPolicyRequest,
    process: Omit<ProcessSandboxRequest, "cwd" | "timeoutMs" | "memoryMb" | "maxCpuMs" | "maxFileDescriptors" | "maxOutputBytes">,
  ): ProcessSandboxRequest {
    this.validateRequest(policy, request);
    return {
      ...process,
      cwd: policy.workspace,
      timeoutMs: request.timeoutMs ?? policy.maxWallClockMillis,
      memoryMb: Math.max(1, Math.ceil((request.memoryBytes ?? policy.maxMemoryBytes) / BYTES_PER_MIB)),
      maxCpuMs: request.cpuMillis ?? policy.maxCpuMillis,
      maxFileDescriptors: request.fileDescriptors ?? policy.maxFileDescriptors,
      maxOutputBytes: policy.maxOutputBytes,
    };
  }

  toResourceBoundaryPolicy(policy: GovernedSandboxPolicy): ResourceBoundaryPolicy {
    return {
      maxMemoryMb: policy.maxMemoryMb,
      maxCpuMs: policy.maxCpuMillis,
      maxFileDescriptors: policy.maxFileDescriptors,
      maxExecutionMs: policy.maxWallClockMillis,
      authorizedWorkspaces: [policy.workspace],
    };
  }

  toResourceBoundaryRequest(policy: GovernedSandboxPolicy, request: SandboxPolicyRequest): ResourceBoundaryRequest {
    this.validateRequest(policy, request);
    return {
      cwd: policy.workspace,
      timeoutMs: request.timeoutMs ?? policy.maxWallClockMillis,
      memoryMb: Math.max(1, Math.ceil((request.memoryBytes ?? policy.maxMemoryBytes) / BYTES_PER_MIB)),
    };
  }

  private validateBudget(resourceBudget: IntentResourceBudget): void {
    assertPositiveInteger(resourceBudget.maxCpuMillis, "maxCpuMillis");
    assertPositiveInteger(resourceBudget.maxMemoryBytes, "maxMemoryBytes");
    assertPositiveInteger(resourceBudget.maxWallClockMillis, "maxWallClockMillis");
    assertPositiveInteger(resourceBudget.maxConcurrentTasks, "maxConcurrentTasks");
    assertNonNegativeInteger(resourceBudget.maxNetworkRequests, "maxNetworkRequests");
    assertNonNegativeInteger(resourceBudget.maxArtifactBytes, "maxArtifactBytes");
  }

  private assertBudgetCeilings(resourceBudget: IntentResourceBudget): void {
    if (resourceBudget.maxMemoryBytes > this.ceilings.maxMemoryBytes) throw new SandboxPolicyViolation("MEMORY_LIMIT", "Intent memory budget exceeds runtime ceiling");
    if (resourceBudget.maxCpuMillis > this.ceilings.maxCpuMillis) throw new SandboxPolicyViolation("CPU_LIMIT", "Intent CPU budget exceeds runtime ceiling");
    if (resourceBudget.maxWallClockMillis > this.ceilings.maxWallClockMillis) throw new SandboxPolicyViolation("TIMEOUT_LIMIT", "Intent wall-clock budget exceeds runtime ceiling");
    if (resourceBudget.maxConcurrentTasks > this.ceilings.maxConcurrentTasks) throw new SandboxPolicyViolation("INVALID_BUDGET", "Intent concurrency budget exceeds runtime ceiling");
    if (resourceBudget.maxNetworkRequests > this.ceilings.maxNetworkRequests) throw new SandboxPolicyViolation("NETWORK_REQUEST_LIMIT", "Intent network-request budget exceeds runtime ceiling");
    if (resourceBudget.maxArtifactBytes > this.ceilings.maxArtifactBytes) throw new SandboxPolicyViolation("ARTIFACT_LIMIT", "Intent artifact budget exceeds runtime ceiling");
  }

  private validateWorkspace(workspace: string): string {
    if (!isAbsolute(workspace)) throw new SandboxPolicyViolation("FILESYSTEM_PATH_DENIED", "Sandbox workspace must be absolute");
    const resolved = realpathSync(workspace);
    if (!statSync(resolved).isDirectory()) throw new SandboxPolicyViolation("FILESYSTEM_PATH_DENIED", "Sandbox workspace must be a directory");
    return resolve(resolved);
  }
}
