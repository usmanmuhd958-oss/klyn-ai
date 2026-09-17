import type {
  HardwareTarget,
  ResourceRequest,
  RuntimeLimits,
  RuntimeResourcePlan,
  TaskSpec,
} from "./types.js";
import { RuntimeBoundaryViolation, freezeDeep, validateLimits } from "./validation.js";

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = freezeDeep({
  maxCpuCores: 64,
  maxCpuMillis: 3_600_000,
  maxMemoryBytes: 256 * 1024 * 1024 * 1024,
  maxWallClockMillis: 3_600_000,
  maxGpuCount: 8,
  maxGpuMemoryBytes: 192 * 1024 * 1024 * 1024,
  maxNetworkRequests: 100_000,
  maxArtifactBytes: 10 * 1024 * 1024 * 1024,
});

function enforceCeiling(value: number, ceiling: number, path: string): number {
  if (value > ceiling) {
    throw new RuntimeBoundaryViolation("RESOURCE_LIMIT", `${path} exceeds runtime ceiling`);
  }
  return value;
}

function enforceCapacity(value: number, capacity: number, path: string): number {
  if (value > capacity) {
    throw new RuntimeBoundaryViolation("TARGET_CAPACITY", `${path} exceeds target capacity`);
  }
  return value;
}

export class ResourceConstraintEnforcer {
  constructor(private readonly limits: RuntimeLimits = DEFAULT_RUNTIME_LIMITS) {
    validateLimits(limits);
  }

  enforce(task: TaskSpec, target: HardwareTarget): RuntimeResourcePlan {
    const request: ResourceRequest = task.signals.resourceRequest;
    enforceCapacity(request.minCpuCores, target.capacity.cpuCores, "minCpuCores");
    enforceCapacity(request.maxMemoryBytes, target.capacity.memoryBytes, "maxMemoryBytes");
    enforceCapacity(request.gpuCount, target.capacity.gpuCount, "gpuCount");
    enforceCapacity(request.minGpuMemoryBytes, target.capacity.gpuMemoryBytes, "minGpuMemoryBytes");

    if (task.signals.requiresGpu && target.accelerator !== "GPU") {
      throw new RuntimeBoundaryViolation("GPU_REQUIRED", "Task requires a GPU-capable target");
    }
    if (task.signals.requiresIsolation && !target.supportsIsolation) {
      throw new RuntimeBoundaryViolation("ISOLATION_REQUIRED", "Task requires target isolation support");
    }

    const cpuCores = enforceCeiling(request.minCpuCores, this.limits.maxCpuCores, "cpuCores");
    const cpuMillis = enforceCeiling(request.maxCpuMillis, this.limits.maxCpuMillis, "cpuMillis");
    const memoryBytes = enforceCeiling(request.maxMemoryBytes, this.limits.maxMemoryBytes, "memoryBytes");
    const wallClockMillis = enforceCeiling(request.maxWallClockMillis, this.limits.maxWallClockMillis, "wallClockMillis");
    const gpuCount = enforceCeiling(request.gpuCount, this.limits.maxGpuCount, "gpuCount");
    const gpuMemoryBytes = enforceCeiling(request.minGpuMemoryBytes, this.limits.maxGpuMemoryBytes, "gpuMemoryBytes");
    const networkRequests = enforceCeiling(request.maxNetworkRequests, this.limits.maxNetworkRequests, "networkRequests");
    const artifactBytes = enforceCeiling(request.maxArtifactBytes, this.limits.maxArtifactBytes, "artifactBytes");

    return freezeDeep({
      cpuCores,
      cpuMillis,
      memoryBytes,
      wallClockMillis,
      gpuCount,
      gpuMemoryBytes,
      networkRequests,
      artifactBytes,
    });
  }
}
