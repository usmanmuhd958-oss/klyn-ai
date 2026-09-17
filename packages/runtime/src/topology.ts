import { cpus, totalmem } from "node:os";
import type {
  AcceleratorKind,
  ComputeCapacity,
  ExecutionBackend,
  GpuDevice,
  HardwareTarget,
  HardwareTopologyProvider,
  HardwareTopologySnapshot,
  RemoteCluster,
  TaskClassification,
  TaskSpec,
  TopologyResolution,
} from "./types.js";
import { RuntimeBoundaryViolation, freezeDeep, validateTopology } from "./validation.js";

function localCapacity(snapshot: HardwareTopologySnapshot): ComputeCapacity {
  return freezeDeep({
    cpuCores: snapshot.localCpu.logicalThreads,
    memoryBytes: snapshot.localCpu.memoryBytes,
    gpuCount: snapshot.localGpus.length,
    gpuMemoryBytes: snapshot.localGpus.reduce((sum, gpu) => sum + gpu.memoryBytes, 0),
  });
}

function targetScore(
  classification: TaskClassification,
  accelerator: AcceleratorKind,
  latency: number,
  capacity: ComputeCapacity,
  supportsIsolation: boolean,
  requiresIsolation: boolean,
): number {
  let score = 0;
  if (classification.taskClass === "LATENCY_SENSITIVE") score += Math.max(0, 10_000 - latency * 50);
  if (classification.taskClass === "HIGH_MEMORY") score += Math.min(5_000, Math.floor(capacity.memoryBytes / (1024 * 1024 * 1024)) * 250);
  if (classification.taskClass === "BATCH") score += 2_000;
  if (classification.taskClass === "ISOLATED_SANDBOX") score += supportsIsolation ? 5_000 : -100_000;
  if (accelerator === "GPU") score += capacity.gpuCount > 0 ? 3_000 : -100_000;
  if (requiresIsolation && !supportsIsolation) score -= 100_000;
  return score;
}

function acceptsTask(target: HardwareTarget, task: TaskSpec): boolean {
  const request = task.signals.resourceRequest;
  if (target.capacity.cpuCores < request.minCpuCores) return false;
  if (target.capacity.memoryBytes < request.maxMemoryBytes) return false;
  if (target.capacity.gpuCount < request.gpuCount) return false;
  if (target.capacity.gpuMemoryBytes < request.minGpuMemoryBytes) return false;
  if (task.signals.requiresGpu && target.accelerator !== "GPU") return false;
  if (task.signals.requiresIsolation && !target.supportsIsolation) return false;
  return true;
}

function acceleratorForGpu(gpuCount: number): AcceleratorKind {
  return gpuCount > 0 ? "GPU" : "CPU";
}

export class StaticHardwareTopologyProvider implements HardwareTopologyProvider {
  constructor(private readonly topology: HardwareTopologySnapshot) {}

  snapshot(): HardwareTopologySnapshot {
    return validateTopology(this.topology);
  }
}

export class NodeHardwareTopologyProvider implements HardwareTopologyProvider {
  constructor(
    private readonly topologyVersion = "node-host",
    private readonly gpuResolver: () => readonly GpuDevice[] = () => [],
    private readonly remoteClusterResolver: () => readonly RemoteCluster[] = () => [],
  ) {}

  snapshot(): HardwareTopologySnapshot {
    const threadCount = cpus().length;
    if (threadCount < 1) {
      throw new RuntimeBoundaryViolation("NO_CPU", "Host CPU topology is unavailable");
    }
    const gpus = this.gpuResolver();
    return validateTopology(
      freezeDeep({
        schemaVersion: "1.0.0",
        topologyVersion: this.topologyVersion,
        capturedAtEpochMs: Date.now(),
        localCpu: {
          architecture: process.arch,
          logicalThreads: threadCount,
          physicalCores: threadCount,
          memoryBytes: totalmem(),
        },
        localGpus: [...gpus],
        localIsolationModes: ["PROCESS"],
        remoteClusters: [...this.remoteClusterResolver()],
      }),
    );
  }
}

export class HardwareTopologyResolver {
  resolve(task: TaskSpec, classification: TaskClassification, topology: HardwareTopologySnapshot): TopologyResolution {
    const snapshot = validateTopology(topology);
    const local = localCapacity(snapshot);
    const targets: HardwareTarget[] = [];

    if (snapshot.localGpus.length > 0) {
      for (const gpu of snapshot.localGpus) {
        const capacity = freezeDeep({
          cpuCores: snapshot.localCpu.logicalThreads,
          memoryBytes: snapshot.localCpu.memoryBytes,
          gpuCount: 1,
          gpuMemoryBytes: gpu.memoryBytes,
        });
        const target = freezeDeep({
          targetId: `local-gpu:${gpu.id}`,
          backend: "LOCAL_GPU" as ExecutionBackend,
          region: "local",
          networkZone: "local",
          estimatedLatencyMillis: 1,
          capacity,
          accelerator: "GPU" as AcceleratorKind,
          supportsIsolation: snapshot.localIsolationModes.length > 0,
          gpuIds: [gpu.id],
          score: targetScore(classification, "GPU", 1, capacity, snapshot.localIsolationModes.length > 0, task.signals.requiresIsolation),
        });
        if (acceptsTask(target, task)) targets.push(target);
      }
    }

    const localTarget = freezeDeep({
      targetId: "local-cpu",
      backend: "LOCAL_CPU" as ExecutionBackend,
      region: "local",
      networkZone: "local",
      estimatedLatencyMillis: 1,
      capacity: local,
      accelerator: acceleratorForGpu(0),
      supportsIsolation: snapshot.localIsolationModes.length > 0,
      gpuIds: [],
      score: targetScore(classification, "CPU", 1, local, snapshot.localIsolationModes.length > 0, task.signals.requiresIsolation),
    });
    if (acceptsTask(localTarget, task)) targets.push(localTarget);

    for (const cluster of snapshot.remoteClusters) {
      const accelerator: AcceleratorKind = cluster.accelerators.includes("GPU") && cluster.capacity.gpuCount > 0 ? "GPU" : "CPU";
      const target = freezeDeep({
        targetId: `remote:${cluster.id}`,
        backend: "REMOTE_CLUSTER" as ExecutionBackend,
        region: cluster.region,
        networkZone: cluster.networkZone,
        estimatedLatencyMillis: cluster.estimatedLatencyMillis,
        capacity: cluster.capacity,
        accelerator,
        supportsIsolation: cluster.supportsIsolation,
        gpuIds: [],
        score: targetScore(classification, accelerator, cluster.estimatedLatencyMillis, cluster.capacity, cluster.supportsIsolation, task.signals.requiresIsolation),
      });
      if (acceptsTask(target, task)) targets.push(target);
    }

    if (targets.length === 0) {
      throw new RuntimeBoundaryViolation("NO_EXECUTION_TARGET", `No hardware target satisfies task ${task.taskId}`);
    }

    targets.sort((left, right) => right.score - left.score || left.targetId.localeCompare(right.targetId));
    return freezeDeep({ selected: targets[0]!, candidates: targets });
  }
}
