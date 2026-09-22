import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
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
import { WorkspaceCasEngine, type ShadowWorkspace } from "./workspace-cas-engine.js";

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
  readonly ioReadBps?: number;
  readonly ioWriteBps?: number;
  readonly rootfs?: string;
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
  readonly committedPaths?: readonly string[];
}

export interface ExecutionKernelOptions {
  readonly mutationEngine?: AstMutationEngine;
  readonly processManager?: ProcessSandboxManager;
  readonly resourceBoundary?: ResourceBoundaryEnforcer;
  readonly casEngine?: WorkspaceCasEngine;
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
  private readonly resourceBoundary: ResourceBoundaryEnforcer;
  private readonly cas: WorkspaceCasEngine;

  public constructor(options: ExecutionKernelOptions = {}) {
    this.mutationEngine = options.mutationEngine ?? new AstMutationEngine();
    this.processManager = options.processManager ?? new ProcessSandboxManager();
    this.resourceBoundary = options.resourceBoundary ?? new ResourceBoundaryEnforcer();
    this.cas = options.casEngine ?? new WorkspaceCasEngine();
  }

  public async execute(request: KernelExecutionRequest): Promise<KernelExecutionResult> {
    const startedAt = Date.now();
    if (!request.executionId.trim()) throw new Error("executionId is required");

    const workspace = this.resourceBoundary.authorizedWorkspace(request.workspace);
    const sourceAbsolute = await realpath(request.sourcePath);
    if (!isWithin(workspace, sourceAbsolute)) throw new Error("sourcePath escapes the authorized workspace");

    const timeoutMs = request.timeoutMs ?? 30_000;
    const memoryMb = request.memoryMb ?? 512;
    const maxCpuMs = request.maxCpuMs ?? timeoutMs;
    const maxFileDescriptors = request.maxFileDescriptors ?? 256;
    const maxOutputBytes = request.maxOutputBytes ?? 1_000_000;
    this.resourceBoundary.assertRuntimeLimits(timeoutMs, memoryMb);

    const shadow = await this.cas.createShadow(workspace);
    let committed = false;
    let rolledBack = false;

    try {
      const relativeSource = relative(workspace, sourceAbsolute);
      const shadowSource = resolve(shadow.shadowRoot, relativeSource);
      const source = await readFile(shadowSource, "utf8");
      const beforeDigest = sha256(source);
      if (request.expectedSourceHash !== undefined && request.expectedSourceHash !== beforeDigest) {
        throw new Error(`Source changed since planning: expected ${request.expectedSourceHash}, observed ${beforeDigest}`);
      }

      const mutation = this.mutationEngine.apply(shadowSource, source, request.mutations);
      if (mutation.changed) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(shadowSource, mutation.source, "utf8");
      }

      const process = await this.processManager.execute({
        command: request.command,
        args: request.args,
        cwd: shadow.shadowRoot,
        env: request.env,
        allowedEnv: request.allowedEnv,
        timeoutMs,
        memoryMb,
        maxCpuMs,
        maxFileDescriptors,
        maxOutputBytes,
        ioReadBps: request.ioReadBps,
        ioWriteBps: request.ioWriteBps,
        rootfs: request.rootfs,
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
        await this.cas.discard(shadow);
        return {
          executionId: request.executionId,
          mutation,
          process,
          committed: false,
          rolledBack: true,
          durationMs: Date.now() - startedAt,
          beforeDigest,
          afterDigest: beforeDigest,
          committedPaths: Object.freeze([]),
        };
      }

      const commit = await this.cas.commit(shadow);
      committed = commit.committed;
      const committedSource = resolve(workspace, relativeSource);
      let afterDigest = sha256("<deleted>");
      try { afterDigest = sha256(await readFile(committedSource, "utf8")); } catch { /* deletion is a valid committed workspace state */ }

      return {
        executionId: request.executionId,
        mutation,
        process,
        committed,
        rolledBack: false,
        durationMs: Date.now() - startedAt,
        beforeDigest,
        afterDigest,
        committedPaths: commit.changedPaths,
      };
    } catch (error) {
      rolledBack = true;
      await this.cas.discard(shadow).catch(() => undefined);
      throw error;
    } finally {
      // A committed shadow has been renamed into place, so discard is idempotent.
      if (!committed && !rolledBack) await this.cas.discard(shadow).catch(() => undefined);
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
