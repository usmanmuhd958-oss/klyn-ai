import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { ProcessSandboxManager, type ProcessSandboxResult } from "./process-sandbox-manager.js";
import { ResourceBoundaryEnforcer } from "./resource-boundary-enforcer.js";
import { RuntimeSnapshotEngine } from "./runtime-snapshot-engine.js";
import {
  SandboxPolicyEngine,
  type IntentResourceBudget,
  type SandboxFilesystemAccess,
  type GovernedSandboxPolicy,
  type SandboxPolicyCeilings,
} from "./SandboxPolicyEngine.js";
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fingerprintDirectory(root: string): Promise<ReadonlyMap<string, string>> {
  const entries = new Map<string, string>();

  const visit = async (directory: string): Promise<void> => {
    const names = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of names) {
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split("\\").join("/");
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      const metadata = await lstat(absolute);
      if (!metadata.isFile()) {
        entries.set(relativePath, `special:${metadata.mode}:${metadata.size}`);
        continue;
      }
      const content = await readFile(absolute);
      entries.set(relativePath, `file:${content.byteLength}:${sha256(content)}`);
    }
  };

  await visit(root);
  return entries;
}

export class PolicyGovernedSandbox {
  private readonly policyEngine: SandboxPolicyEngine;
  private readonly processManager: ProcessSandboxManager;
  private readonly snapshots: RuntimeSnapshotEngine;
  private readonly resourceBoundary: ResourceBoundaryEnforcer;
  private readonly defaultCollector: ObservationCollector;
  private readonly readRoots: readonly string[] | undefined;
  private readonly writeRoots: readonly string[] | undefined;

  constructor(options: PolicyGovernedSandboxOptions = {}) {
    this.policyEngine = options.policyEngine ?? new SandboxPolicyEngine(options.policyContext?.ceilings);
    this.processManager = options.processManager ?? new ProcessSandboxManager();
    this.snapshots = options.snapshotEngine ?? new RuntimeSnapshotEngine();
    this.resourceBoundary = options.resourceBoundary ?? new ResourceBoundaryEnforcer();
    this.defaultCollector = options.observationCollector ?? new ObservationCollector();
    this.readRoots = options.policyContext?.readRoots;
    this.writeRoots = options.policyContext?.writeRoots;
  }

  async execute(request: PolicyGovernedSandboxRequest): Promise<PolicyGovernedSandboxResult> {
    const policy = this.policyEngine.translate(request.resourceBudget, {
      workspace: request.cwd,
      readRoots: this.readRoots,
      writeRoots: this.writeRoots,
    });
    this.policyEngine.validateRequest(policy, request);
    this.resourceBoundary.authorizedWorkspace(policy.workspace);
    this.resourceBoundary.assertRuntimeLimits(
      request.timeoutMs ?? policy.maxWallClockMillis,
      Math.max(1, Math.ceil((request.memoryBytes ?? policy.maxMemoryBytes) / (1024 * 1024))),
    );

    const collector = this.defaultCollector.createChild();
    collector.begin({ executionId: `${request.intentId}:${request.taskId}`, taskId: request.taskId, agentId: request.agentId });
    collector.record("process.started", { command: request.command, args: [...(request.args ?? [])] });

    const before = await fingerprintDirectory(policy.workspace);
    const snapshot = await this.snapshots.create(policy.workspace);
    let rolledBack = false;
    let rollbackReason: string | undefined;
    let result: ProcessSandboxResult;

    try {
      const processRequest = this.policyEngine.toProcessSandboxRequest(policy, request, {
        command: request.command,
        args: request.args,
        env: request.env,
        allowedEnv: request.allowedEnv,
        fenceKey: request.fenceKey ?? `${request.intentId}:${request.taskId}`,
        ownerId: request.ownerId ?? request.agentId,
      });
      result = await this.processManager.execute(processRequest);

      if (result.stdout.length > 0) collector.record("stdout", { value: result.stdout });
      if (result.stderr.length > 0) collector.record("stderr", { value: result.stderr });
      collector.record("resource.snapshot", {
        durationMs: result.durationMs,
        memoryLimitBytes: policy.maxMemoryBytes,
        cpuLimitMs: policy.maxCpuMillis,
        fileDescriptorLimit: policy.maxFileDescriptors,
        timeoutLimitMs: policy.maxWallClockMillis,
        memoryExceeded: result.memoryExceeded,
        timedOut: result.timedOut,
      });

      const after = await fingerprintDirectory(policy.workspace);
      collector.recordFilesystemMutations(before, after);

      const failed = result.timedOut || result.memoryExceeded || result.signal !== null || ((request.rollbackOnNonZeroExit ?? true) && result.exitCode !== 0);
      if (failed) {
        rolledBack = true;
        rollbackReason = result.memoryExceeded
          ? "memory limit exceeded"
          : result.timedOut
            ? "execution timeout exceeded"
            : result.signal !== null
              ? `process terminated by ${result.signal}`
              : `process exited with code ${String(result.exitCode)}`;
        await this.snapshots.rollback(snapshot);
        collector.record("sandbox.rollback", { reason: rollbackReason });
      }

      collector.record("process.exited", {
        exitCode: result.exitCode,
        signal: result.signal,
        rolledBack,
      });
    } catch (error) {
      rolledBack = true;
      rollbackReason = error instanceof Error ? error.message : String(error);
      await this.snapshots.rollback(snapshot);
      collector.record("sandbox.rollback", { reason: rollbackReason });
      collector.record("process.exited", { exitCode: null, signal: null, rolledBack: true });
      throw error;
    } finally {
      await this.snapshots.discard(snapshot);
    }

    const observation = collector.finalize();
    return {
      process: result,
      policy,
      rolledBack,
      ...(rollbackReason === undefined ? {} : { rollbackReason }),
      events: observation.events,
      eventStreamHash: observation.streamHash,
    };
  }
}
