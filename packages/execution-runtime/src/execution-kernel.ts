import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  AstMutationEngine,
  type AstMutation,
  type AstMutationResult,
} from "./ast-transformer.js";
import {
  ProcessSandboxManager,
  type ProcessSandboxPolicy,
  type ProcessSandboxResult,
} from "./process-sandbox-manager.js";
import { ResourceBoundaryEnforcer, type ResourceBoundaryPolicy } from "./resource-boundary-enforcer.js";
import { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";

export interface KernelExecutionRequest {
  readonly executionId: string;
  readonly workspace: string;
  readonly sourcePath: string;
  readonly mutations: readonly AstMutation[];
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly allowedEnv?: readonly string[];
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
  readonly maxCpuMs?: number;
  readonly maxFileDescriptors?: number;
  readonly maxOutputBytes?: number;
  readonly ownerId?: string;
  readonly expectedSourceHash?: string;
  readonly rollbackOnNonZeroExit?: boolean;
}

export interface KernelExecutionResult {
  readonly executionId: string;
  readonly mutation: AstMutationResult;
  readonly process: ProcessSandboxResult;
  readonly committed: boolean;
  readonly rolledBack: boolean;
  readonly durationMs: number;
  readonly beforeDigest: string;
  readonly afterDigest: string;
}

export interface ExecutionKernelOptions {
  readonly mutationEngine?: AstMutationEngine;
  readonly processManager?: ProcessSandboxManager;
  readonly snapshotEngine?: RuntimeSnapshotEngine;
  readonly resourceBoundary?: ResourceBoundaryEnforcer;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class ExecutionKernel {
  private readonly mutationEngine: AstMutationEngine;
  private readonly processManager: ProcessSandboxManager;
  private readonly snapshots: RuntimeSnapshotEngine;
  private readonly resourceBoundary: ResourceBoundaryEnforcer;

  public constructor(options: ExecutionKernelOptions = {}) {
    this.mutationEngine = options.mutationEngine ?? new AstMutationEngine();
    this.processManager = options.processManager ?? new ProcessSandboxManager();
    this.snapshots = options.snapshotEngine ?? new RuntimeSnapshotEngine();
    this.resourceBoundary = options.resourceBoundary ?? new ResourceBoundaryEnforcer();
  }

  public async execute(request: KernelExecutionRequest): Promise<KernelExecutionResult> {
    const startedAt = Date.now();
    if (!request.executionId.trim()) throw new Error("executionId is required");

    const workspace = this.resourceBoundary.authorizedWorkspace(request.workspace);
    const sourceAbsolute = resolve(request.sourcePath);
    if (!isWithin(workspace, sourceAbsolute)) {
      throw new Error("sourcePath is outside the authorized workspace");
    }

    const source = await readFile(sourceAbsolute, "utf8");
    const beforeDigest = sha256(source);
    if (request.expectedSourceHash !== undefined && request.expectedSourceHash !== beforeDigest) {
      throw new Error(
        `Source changed since planning: expected ${request.expectedSourceHash}, observed ${beforeDigest}`,
      );
    }

    const mutation = this.mutationEngine.apply(sourceAbsolute, source, request.mutations);
    const timeoutMs = request.timeoutMs ?? 30_000;
    const memoryMb = request.memoryMb ?? 512;
    const maxCpuMs = request.maxCpuMs ?? timeoutMs;
    const maxFileDescriptors = request.maxFileDescriptors ?? 256;
    const maxOutputBytes = request.maxOutputBytes ?? 1_000_000;

    this.resourceBoundary.assertRuntimeLimits(timeoutMs, memoryMb);

    const snapshot = await this.snapshots.create(workspace);
    let rolledBack = false;
    let committed = false;

    try {
      if (mutation.changed) {
        await writeFile(sourceAbsolute, mutation.source, "utf8");
      }

      const process = await this.processManager.execute({
        command: request.command,
        args: request.args,
        cwd: workspace,
        env: request.env,
        allowedEnv: request.allowedEnv,
        timeoutMs,
        memoryMb,
        maxCpuMs,
        maxFileDescriptors,
        maxOutputBytes,
        fenceKey: `kernel:${request.executionId}`,
        ownerId: request.ownerId ?? request.executionId,
      });

      const failed =
        process.timedOut ||
        process.memoryExceeded ||
        process.signal !== null ||
        ((request.rollbackOnNonZeroExit ?? true) && process.exitCode !== 0);

      if (failed) {
        rolledBack = true;
        await this.snapshots.rollback(snapshot);
      } else {
        committed = true;
      }

      const persistedSource = await readFile(sourceAbsolute, "utf8");
      return {
        executionId: request.executionId,
        mutation,
        process,
        committed,
        rolledBack,
        durationMs: Date.now() - startedAt,
        beforeDigest,
        afterDigest: sha256(persistedSource),
      };
    } catch (error) {
      rolledBack = true;
      await this.snapshots.rollback(snapshot).catch((rollbackError: unknown) => {
        const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`Execution failed and workspace rollback failed: ${message}`, { cause: error });
      });
      throw error;
    } finally {
      await this.snapshots.discard(snapshot);
    }
  }
}

export interface ExecutionKernelPolicy {
  readonly process?: ProcessSandboxPolicy;
  readonly resources?: ResourceBoundaryPolicy;
}

export function createExecutionKernel(policy: ExecutionKernelPolicy = {}): ExecutionKernel {
  return new ExecutionKernel({
    processManager: new ProcessSandboxManager(policy.process),
    resourceBoundary: new ResourceBoundaryEnforcer(policy.resources),
  });
}
