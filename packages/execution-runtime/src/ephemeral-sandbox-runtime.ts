import { ResourceBoundaryEnforcer, type ResourceBoundaryPolicy } from "./resource-boundary-enforcer.js";
import { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";
import { ProcessSandboxManager, type ProcessSandboxPolicy, type ProcessSandboxResult } from "./process-sandbox-manager.js";

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

export class EphemeralSandboxRuntime {
  private readonly enforcer: ResourceBoundaryEnforcer;
  private readonly processSandbox: ProcessSandboxManager;
  private readonly snapshots: RuntimeSnapshotEngine;

  constructor(options: EphemeralSandboxRuntimeOptions = {}) {
    this.enforcer = new ResourceBoundaryEnforcer(options.resourcePolicy);
    this.processSandbox = new ProcessSandboxManager(options.processPolicy);
    this.snapshots = options.snapshotEngine ?? new RuntimeSnapshotEngine();
  }

  async execute(request: EphemeralSandboxRequest): Promise<ProcessSandboxResult> {
    const workspace = this.enforcer.validate(request);
    this.enforcer.assertRuntimeLimits(request.timeoutMs ?? 30_000, request.memoryMb ?? 512);
    const snapshot = await this.snapshots.create(workspace);
    try {
      const result = await this.processSandbox.execute({
        ...request,
        cwd: workspace,
        fenceKey: request.fenceKey ?? workspace,
        ownerId: request.ownerId ?? `sandbox-${Date.now()}`,
      });
      if (result.exitCode !== 0 || result.timedOut || result.memoryExceeded || result.signal !== null) {
        await this.snapshots.rollback(snapshot);
      }
      return result;
    } catch (error) {
      await this.snapshots.rollback(snapshot);
      throw error;
    } finally {
      await this.snapshots.discard(snapshot);
    }
  }
}
