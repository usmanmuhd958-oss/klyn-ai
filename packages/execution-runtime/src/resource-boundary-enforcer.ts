import { realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

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

export class ResourceBoundaryEnforcer {
  constructor(private readonly policy: ResourceBoundaryPolicy = DEFAULT_RESOURCE_BOUNDARY_POLICY) {}

  validate(request: ResourceBoundaryRequest): string {
    const workspace = this.authorizedWorkspace(request.cwd);
    const timeoutMs = request.timeoutMs ?? this.policy.maxExecutionMs;
    const memoryMb = request.memoryMb ?? this.policy.maxMemoryMb;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > this.policy.maxExecutionMs) {
      throw new ResourceBoundaryViolation("Execution timeout exceeds sandbox policy");
    }
    if (!Number.isInteger(memoryMb) || memoryMb <= 0 || memoryMb > this.policy.maxMemoryMb) {
      throw new ResourceBoundaryViolation("Memory budget exceeds sandbox policy");
    }
    return workspace;
  }

  authorizedWorkspace(cwd: string): string {
    if (!cwd || !isAbsolute(cwd)) throw new ResourceBoundaryViolation("Sandbox cwd must be absolute");
    const resolved = realpathSync(cwd);
    if (!statSync(resolved).isDirectory()) throw new ResourceBoundaryViolation("Sandbox cwd must be a directory");
    if (this.policy.authorizedWorkspaces.length === 0) return resolved;
    const allowed = this.policy.authorizedWorkspaces.map((entry) => realpathSync(entry));
    const inside = allowed.some((root) => {
      const rel = relative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
    if (!inside) throw new ResourceBoundaryViolation("Sandbox cwd is outside authorized workspaces");
    return resolve(resolved);
  }

  assertRuntimeLimits(timeoutMs: number, memoryMb: number): void {
    if (timeoutMs > this.policy.maxExecutionMs) throw new ResourceBoundaryViolation("Execution timeout limit exceeded");
    if (memoryMb > this.policy.maxMemoryMb) throw new ResourceBoundaryViolation("Memory limit exceeded");
  }
}
