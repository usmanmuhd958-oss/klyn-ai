import { createHash } from "node:crypto";
import type {
  ExecutionPlan,
  HardwareTarget,
  IsolationMode,
  NetworkMode,
  RuntimeResourcePlan,
  SandboxPlan,
  TaskSpec,
} from "./types.js";
import { RuntimeBoundaryViolation, freezeDeep } from "./validation.js";

export interface SandboxPolicy {
  readonly defaultIsolation: IsolationMode;
  readonly allowedIsolationModes: readonly IsolationMode[];
  readonly allowedEnvironment: readonly string[];
  readonly readOnlyPaths: readonly string[];
  readonly writablePaths: readonly string[];
  readonly defaultNetworkMode: NetworkMode;
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = freezeDeep({
  defaultIsolation: "PROCESS",
  allowedIsolationModes: ["PROCESS", "CONTAINER", "MICRO_VM", "REMOTE_SANDBOX"],
  allowedEnvironment: [],
  readOnlyPaths: [],
  writablePaths: [],
  defaultNetworkMode: "RESTRICTED",
});

function canonicalParts(task: TaskSpec, target: HardwareTarget, resources: RuntimeResourcePlan, policy: SandboxPolicy): string[] {
  return [
    "klyn-runtime-sandbox-v1",
    task.taskId,
    task.workloadRef,
    JSON.stringify(task.args),
    String(task.priority),
    target.targetId,
    target.backend,
    String(resources.cpuCores),
    String(resources.cpuMillis),
    String(resources.memoryBytes),
    String(resources.wallClockMillis),
    String(resources.gpuCount),
    String(resources.gpuMemoryBytes),
    String(resources.networkRequests),
    String(resources.artifactBytes),
    policy.defaultIsolation,
    [...policy.allowedIsolationModes].sort().join(","),
    [...policy.allowedEnvironment].sort().join(","),
    [...policy.readOnlyPaths].sort().join(","),
    [...policy.writablePaths].sort().join(","),
    policy.defaultNetworkMode,
  ];
}

function chooseIsolation(task: TaskSpec, target: HardwareTarget, policy: SandboxPolicy): IsolationMode {
  if (!task.signals.requiresIsolation) return policy.defaultIsolation;
  if (!target.supportsIsolation) {
    throw new RuntimeBoundaryViolation("ISOLATION_REQUIRED", "Selected target cannot provide isolation");
  }
  const preferred: IsolationMode = target.backend === "REMOTE_CLUSTER" ? "REMOTE_SANDBOX" : policy.defaultIsolation;
  if (!policy.allowedIsolationModes.includes(preferred)) {
    throw new RuntimeBoundaryViolation("ISOLATION_POLICY", `Isolation mode ${preferred} is not permitted`);
  }
  return preferred;
}

export class DeterministicSandboxPlanner {
  constructor(private readonly policy: SandboxPolicy = DEFAULT_SANDBOX_POLICY) {}

  create(task: TaskSpec, target: HardwareTarget, resources: RuntimeResourcePlan): SandboxPlan {
    const isolationMode = chooseIsolation(task, target, this.policy);
    const networkMode: NetworkMode = task.signals.requiresNetwork ? this.policy.defaultNetworkMode : "NONE";
    const canonical = canonicalParts(task, target, resources, this.policy).join("|");
    const resourcePlanHash = createHash("sha256").update(JSON.stringify(resources), "utf8").digest("hex");
    const sandboxId = createHash("sha256").update(canonical, "utf8").digest("hex");
    return freezeDeep({
      planVersion: "1.0.0",
      sandboxId,
      isolationMode,
      networkMode,
      environmentAllowlist: [...this.policy.allowedEnvironment].sort(),
      readOnlyPaths: [...this.policy.readOnlyPaths].sort(),
      writablePaths: [...this.policy.writablePaths].sort(),
      deterministicSeed: sandboxId.slice(0, 32),
      resourcePlanHash,
    });
  }

  verify(plan: SandboxPlan, executionPlan: ExecutionPlan): boolean {
    const task: TaskSpec = freezeDeep({
      schemaVersion: "1.0.0",
      taskId: executionPlan.taskId,
      workloadRef: executionPlan.workloadRef,
      args: [...executionPlan.args],
      priority: executionPlan.priority,
      signals: {
        estimatedCpuMillis: executionPlan.resources.cpuMillis,
        estimatedMemoryBytes: executionPlan.resources.memoryBytes,
        requiresIsolation: executionPlan.classification.taskClass === "ISOLATED_SANDBOX",
        preferredAccelerator: executionPlan.topology.selected.accelerator,
        requiresGpu: executionPlan.resources.gpuCount > 0,
        requiresNetwork: executionPlan.resources.networkRequests > 0,
        resourceRequest: {
          minCpuCores: executionPlan.resources.cpuCores,
          maxCpuMillis: executionPlan.resources.cpuMillis,
          maxMemoryBytes: executionPlan.resources.memoryBytes,
          maxWallClockMillis: executionPlan.resources.wallClockMillis,
          gpuCount: executionPlan.resources.gpuCount,
          minGpuMemoryBytes: executionPlan.resources.gpuMemoryBytes,
          maxNetworkRequests: executionPlan.resources.networkRequests,
          maxArtifactBytes: executionPlan.resources.artifactBytes,
        },
      },
    });
    const expected = this.create(task, executionPlan.topology.selected, executionPlan.resources);
    return expected.sandboxId === plan.sandboxId && expected.resourcePlanHash === plan.resourcePlanHash;
  }
}
