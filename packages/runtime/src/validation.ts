import type {
  ComputeCapacity,
  CpuTopology,
  GpuDevice,
  HardwareTopologySnapshot,
  IsolationMode,
  RemoteCluster,
  ResourceRequest,
  RuntimeExecutionObservation,
  RuntimeLimits,
  RuntimeResourceUsage,
  TaskSignals,
  TaskSpec,
} from "./types.js";

export class RuntimeBoundaryViolation extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeBoundaryViolation";
    this.code = code;
  }
}

export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeDeep(child);
  }
  return Object.freeze(value);
}

function expectObject(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new RuntimeBoundaryViolation("INVALID_OBJECT", `${path} must be an object`);
  }
  return input as Record<string, unknown>;
}

function expectString(input: unknown, path: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new RuntimeBoundaryViolation("INVALID_STRING", `${path} must be a non-empty string`);
  }
  return input;
}

function expectInteger(input: unknown, path: string, minimum = 0): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < minimum) {
    throw new RuntimeBoundaryViolation("INVALID_INTEGER", `${path} must be an integer >= ${minimum}`);
  }
  return input;
}

function expectBoolean(input: unknown, path: string): boolean {
  if (typeof input !== "boolean") {
    throw new RuntimeBoundaryViolation("INVALID_BOOLEAN", `${path} must be boolean`);
  }
  return input;
}

function expectStringArray(input: unknown, path: string): readonly string[] {
  if (!Array.isArray(input)) {
    throw new RuntimeBoundaryViolation("INVALID_ARRAY", `${path} must be an array`);
  }
  return input.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function validateIsolationModes(input: unknown, path: string): readonly IsolationMode[] {
  const values = expectStringArray(input, path);
  const allowed: readonly IsolationMode[] = ["PROCESS", "CONTAINER", "MICRO_VM", "REMOTE_SANDBOX"];
  for (const value of values) {
    if (!allowed.includes(value as IsolationMode)) {
      throw new RuntimeBoundaryViolation("INVALID_ISOLATION_MODE", `${path} contains an invalid isolation mode`);
    }
  }
  return values as readonly IsolationMode[];
}

function parseResourceRequest(input: unknown, path: string): ResourceRequest {
  const object = expectObject(input, path);
  return freezeDeep({
    minCpuCores: expectInteger(object.minCpuCores, `${path}.minCpuCores`, 1),
    maxCpuMillis: expectInteger(object.maxCpuMillis, `${path}.maxCpuMillis`, 1),
    maxMemoryBytes: expectInteger(object.maxMemoryBytes, `${path}.maxMemoryBytes`, 1),
    maxWallClockMillis: expectInteger(object.maxWallClockMillis, `${path}.maxWallClockMillis`, 1),
    gpuCount: expectInteger(object.gpuCount, `${path}.gpuCount`, 0),
    minGpuMemoryBytes: expectInteger(object.minGpuMemoryBytes, `${path}.minGpuMemoryBytes`, 0),
    maxNetworkRequests: expectInteger(object.maxNetworkRequests, `${path}.maxNetworkRequests`, 0),
    maxArtifactBytes: expectInteger(object.maxArtifactBytes, `${path}.maxArtifactBytes`, 0),
  });
}

function parseSignals(input: unknown): TaskSignals {
  const object = expectObject(input, "signals");
  const preferred = expectString(object.preferredAccelerator, "signals.preferredAccelerator");
  if (preferred !== "CPU" && preferred !== "GPU" && preferred !== "NONE") {
    throw new RuntimeBoundaryViolation("INVALID_ACCELERATOR", "signals.preferredAccelerator is invalid");
  }

  const requiresGpu = expectBoolean(object.requiresGpu, "signals.requiresGpu");
  const requiresNetwork = expectBoolean(object.requiresNetwork, "signals.requiresNetwork");
  const estimatedCpuMillis = expectInteger(object.estimatedCpuMillis, "signals.estimatedCpuMillis", 1);
  const estimatedMemoryBytes = expectInteger(object.estimatedMemoryBytes, "signals.estimatedMemoryBytes", 1);
  const resourceRequest = parseResourceRequest(object.resourceRequest, "signals.resourceRequest");

  if (estimatedCpuMillis > resourceRequest.maxCpuMillis) {
    throw new RuntimeBoundaryViolation("RESOURCE_MISMATCH", "estimatedCpuMillis exceeds maxCpuMillis");
  }
  if (estimatedMemoryBytes > resourceRequest.maxMemoryBytes) {
    throw new RuntimeBoundaryViolation("RESOURCE_MISMATCH", "estimatedMemoryBytes exceeds maxMemoryBytes");
  }
  if (requiresGpu && resourceRequest.gpuCount < 1) {
    throw new RuntimeBoundaryViolation("RESOURCE_MISMATCH", "GPU is required but gpuCount is zero");
  }
  if (requiresNetwork && resourceRequest.maxNetworkRequests < 1) {
    throw new RuntimeBoundaryViolation("RESOURCE_MISMATCH", "network is required but maxNetworkRequests is zero");
  }

  return freezeDeep({
    estimatedCpuMillis,
    estimatedMemoryBytes,
    latencyBudgetMillis:
      object.latencyBudgetMillis === undefined
        ? undefined
        : expectInteger(object.latencyBudgetMillis, "signals.latencyBudgetMillis", 1),
    batchSize:
      object.batchSize === undefined ? undefined : expectInteger(object.batchSize, "signals.batchSize", 1),
    requiresIsolation: expectBoolean(object.requiresIsolation, "signals.requiresIsolation"),
    preferredAccelerator: preferred,
    requiresGpu,
    requiresNetwork,
    resourceRequest,
  });
}

export function parseTaskSpec(input: unknown): TaskSpec {
  const object = expectObject(input, "task");
  const schemaVersion = expectString(object.schemaVersion, "task.schemaVersion");
  if (schemaVersion !== "1.0.0") {
    throw new RuntimeBoundaryViolation("UNSUPPORTED_SCHEMA", `Unsupported task schema: ${schemaVersion}`);
  }
  const priorityValue = expectInteger(object.priority, "task.priority", 0);
  if (priorityValue > 3) {
    throw new RuntimeBoundaryViolation("INVALID_PRIORITY", "task.priority must be between 0 and 3");
  }
  return freezeDeep({
    schemaVersion,
    taskId: expectString(object.taskId, "task.taskId"),
    workloadRef: expectString(object.workloadRef, "task.workloadRef"),
    args: expectStringArray(object.args, "task.args"),
    priority: priorityValue as 0 | 1 | 2 | 3,
    signals: parseSignals(object.signals),
  });
}

function parseUsage(input: unknown): RuntimeResourceUsage {
  const object = expectObject(input, "observation.usage");
  return freezeDeep({
    cpuMillis: expectInteger(object.cpuMillis, "observation.usage.cpuMillis", 0),
    memoryBytes: expectInteger(object.memoryBytes, "observation.usage.memoryBytes", 0),
    wallClockMillis: expectInteger(object.wallClockMillis, "observation.usage.wallClockMillis", 0),
    gpuCount: expectInteger(object.gpuCount, "observation.usage.gpuCount", 0),
    gpuMemoryBytes: expectInteger(object.gpuMemoryBytes, "observation.usage.gpuMemoryBytes", 0),
    networkRequests: expectInteger(object.networkRequests, "observation.usage.networkRequests", 0),
    artifactBytes: expectInteger(object.artifactBytes, "observation.usage.artifactBytes", 0),
  });
}

export function parseExecutionObservation(input: unknown): RuntimeExecutionObservation {
  const object = expectObject(input, "observation");
  const exitCodeInput = object.exitCode;
  const exitCode = exitCodeInput === null ? null : expectInteger(exitCodeInput, "observation.exitCode", 0);
  const verification = expectObject(object.verification, "observation.verification");
  const outputDigest = expectString(object.outputDigest, "observation.outputDigest");
  if (!/^[a-f0-9]{64}$/.test(outputDigest)) {
    throw new RuntimeBoundaryViolation("INVALID_OUTPUT_DIGEST", "observation.outputDigest must be SHA-256 hex");
  }
  return freezeDeep({
    exitCode,
    usage: parseUsage(object.usage),
    verification: {
      verified: expectBoolean(verification.verified, "observation.verification.verified"),
      reasons: expectStringArray(verification.reasons, "observation.verification.reasons"),
    },
    outputDigest,
  });
}

function validateCapacity(capacity: ComputeCapacity, path: string): void {
  if (typeof capacity !== "object" || capacity === null) {
    throw new RuntimeBoundaryViolation("INVALID_OBJECT", `${path} must be an object`);
  }
  expectInteger(capacity.cpuCores, `${path}.cpuCores`, 1);
  expectInteger(capacity.memoryBytes, `${path}.memoryBytes`, 1);
  expectInteger(capacity.gpuCount, `${path}.gpuCount`, 0);
  expectInteger(capacity.gpuMemoryBytes, `${path}.gpuMemoryBytes`, 0);
}

function validateCpu(cpu: CpuTopology): void {
  expectString(cpu.architecture, "localCpu.architecture");
  expectInteger(cpu.logicalThreads, "localCpu.logicalThreads", 1);
  expectInteger(cpu.physicalCores, "localCpu.physicalCores", 1);
  expectInteger(cpu.memoryBytes, "localCpu.memoryBytes", 1);
  if (cpu.physicalCores > cpu.logicalThreads) {
    throw new RuntimeBoundaryViolation("INVALID_CPU_TOPOLOGY", "physicalCores cannot exceed logicalThreads");
  }
}

function validateGpu(gpu: GpuDevice): void {
  if (typeof gpu !== "object" || gpu === null) {
    throw new RuntimeBoundaryViolation("INVALID_OBJECT", "gpu must be an object");
  }
  expectString(gpu.id, "gpu.id");
  expectString(gpu.vendor, "gpu.vendor");
  expectString(gpu.model, "gpu.model");
  expectInteger(gpu.memoryBytes, "gpu.memoryBytes", 1);
}

function validateRemoteCluster(cluster: RemoteCluster): void {
  expectString(cluster.id, "remoteCluster.id");
  expectString(cluster.region, "remoteCluster.region");
  expectString(cluster.networkZone, "remoteCluster.networkZone");
  expectInteger(cluster.estimatedLatencyMillis, "remoteCluster.estimatedLatencyMillis", 0);
  validateCapacity(cluster.capacity, "remoteCluster.capacity");
  if (!Array.isArray(cluster.accelerators)) {
    throw new RuntimeBoundaryViolation("INVALID_ACCELERATORS", "remoteCluster.accelerators must be an array");
  }
  validateIsolationModes(cluster.isolationModes, "remoteCluster.isolationModes");
}

export function validateTopology(snapshot: HardwareTopologySnapshot): HardwareTopologySnapshot {
  if (typeof snapshot !== "object" || snapshot === null) {
    throw new RuntimeBoundaryViolation("INVALID_OBJECT", "topology snapshot must be an object");
  }
  expectString(snapshot.schemaVersion, "schemaVersion");
  if (snapshot.schemaVersion !== "1.0.0") {
    throw new RuntimeBoundaryViolation("UNSUPPORTED_SCHEMA", "Unsupported topology schema");
  }
  expectString(snapshot.topologyVersion, "topologyVersion");
  expectInteger(snapshot.capturedAtEpochMs, "capturedAtEpochMs", 0);
  validateCpu(snapshot.localCpu);
  if (!Array.isArray(snapshot.localGpus)) {
    throw new RuntimeBoundaryViolation("INVALID_GPU_LIST", "localGpus must be an array");
  }
  if (!Array.isArray(snapshot.localIsolationModes)) {
    throw new RuntimeBoundaryViolation("INVALID_ISOLATION_LIST", "localIsolationModes must be an array");
  }
  if (!Array.isArray(snapshot.remoteClusters)) {
    throw new RuntimeBoundaryViolation("INVALID_CLUSTER_LIST", "remoteClusters must be an array");
  }
  snapshot.localGpus.forEach(validateGpu);
  validateIsolationModes(snapshot.localIsolationModes, "localIsolationModes");
  snapshot.remoteClusters.forEach(validateRemoteCluster);
  if (snapshot.localIsolationModes.length === 0) {
    throw new RuntimeBoundaryViolation("NO_LOCAL_SANDBOX", "At least one local isolation mode is required");
  }
  return freezeDeep(snapshot);
}

export function validateLimits(limits: RuntimeLimits): RuntimeLimits {
  expectInteger(limits.maxCpuCores, "limits.maxCpuCores", 1);
  expectInteger(limits.maxCpuMillis, "limits.maxCpuMillis", 1);
  expectInteger(limits.maxMemoryBytes, "limits.maxMemoryBytes", 1);
  expectInteger(limits.maxWallClockMillis, "limits.maxWallClockMillis", 1);
  expectInteger(limits.maxGpuCount, "limits.maxGpuCount", 0);
  expectInteger(limits.maxGpuMemoryBytes, "limits.maxGpuMemoryBytes", 0);
  expectInteger(limits.maxNetworkRequests, "limits.maxNetworkRequests", 0);
  expectInteger(limits.maxArtifactBytes, "limits.maxArtifactBytes", 0);
  return freezeDeep(limits);
}
