import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

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

export const DEFAULT_RESOURCE_BOUNDARY_POLICY: ResourceBoundaryPolicy = {
  maxMemoryMb: 512,
  maxCpuMs: 30_000,
  maxFileDescriptors: 256,
  maxExecutionMs: 30_000,
  authorizedWorkspaces: [],
};

export class ResourceBoundaryViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceBoundaryViolation";
  }
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class ResourceBoundaryEnforcer {
  constructor(private readonly policy: ResourceBoundaryPolicy = DEFAULT_RESOURCE_BOUNDARY_POLICY) {}

  validate(request: ResourceBoundaryRequest): string {
    const workspace = this.authorizedWorkspace(request.cwd);
    const timeoutMs = request.timeoutMs ?? this.policy.maxExecutionMs;
    const memoryMb = request.memoryMb ?? this.policy.maxMemoryMb;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > this.policy.maxExecutionMs) {
      throw new ResourceBoundaryViolation("Execution timeout exceeds sandbox policy");
    }
    if (!Number.isSafeInteger(memoryMb) || memoryMb <= 0 || memoryMb > this.policy.maxMemoryMb) {
      throw new ResourceBoundaryViolation("Memory budget exceeds sandbox policy");
    }
    return workspace;
  }

  authorizedWorkspace(cwd: string): string {
    if (!cwd || !isAbsolute(cwd)) throw new ResourceBoundaryViolation("Sandbox cwd must be absolute");
    let resolved: string;
    try { resolved = realpathSync(cwd); } catch (error) {
      throw new ResourceBoundaryViolation(`Workspace canonicalization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!statSync(resolved).isDirectory()) throw new ResourceBoundaryViolation("Sandbox cwd must be a directory");
    if (this.policy.authorizedWorkspaces.length === 0) {
      throw new ResourceBoundaryViolation("No authorized workspace roots configured; refusing fail-open execution");
    }
    const allowed = this.policy.authorizedWorkspaces.map((entry) => {
      if (!isAbsolute(entry)) throw new ResourceBoundaryViolation("Authorized workspace roots must be absolute");
      try { return realpathSync(entry); } catch (error) {
        throw new ResourceBoundaryViolation(`Authorized workspace canonicalization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    if (!allowed.some((root) => within(root, resolved))) {
      throw new ResourceBoundaryViolation("Sandbox cwd is outside authorized workspaces");
    }
    return resolved;
  }

  assertRuntimeLimits(timeoutMs: number, memoryMb: number): void {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > this.policy.maxExecutionMs) {
      throw new ResourceBoundaryViolation("Execution timeout limit exceeded");
    }
    if (!Number.isSafeInteger(memoryMb) || memoryMb <= 0 || memoryMb > this.policy.maxMemoryMb) {
      throw new ResourceBoundaryViolation("Memory limit exceeded");
    }
  }
}
