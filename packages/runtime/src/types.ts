export const RUNTIME_SCHEMA_VERSION = "1.0.0" as const;

export type TaskClass =
  | "LATENCY_SENSITIVE"
  | "HIGH_MEMORY"
  | "BATCH"
  | "ISOLATED_SANDBOX";

export type ExecutionBackend = "LOCAL_CPU" | "LOCAL_GPU" | "REMOTE_CLUSTER";
export type AcceleratorKind = "CPU" | "GPU" | "NONE";
export type NetworkMode = "NONE" | "RESTRICTED" | "FULL";
export type IsolationMode = "PROCESS" | "CONTAINER" | "MICRO_VM" | "REMOTE_SANDBOX";
export type RuntimeStatus = "SUCCEEDED_VERIFIED" | "FAILED" | "UNVERIFIED";

export interface ResourceRequest {
  readonly minCpuCores: number;
  readonly maxCpuMillis: number;
  readonly maxMemoryBytes: number;
  readonly maxWallClockMillis: number;
  readonly gpuCount: number;
  readonly minGpuMemoryBytes: number;
  readonly maxNetworkRequests: number;
  readonly maxArtifactBytes: number;
}

export interface TaskSignals {
  readonly estimatedCpuMillis: number;
  readonly estimatedMemoryBytes: number;
  readonly latencyBudgetMillis?: number;
  readonly batchSize?: number;
  readonly requiresIsolation: boolean;
  readonly preferredAccelerator: AcceleratorKind;
  readonly requiresGpu: boolean;
  readonly requiresNetwork: boolean;
  readonly resourceRequest: ResourceRequest;
}

export interface TaskSpec {
  readonly schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  readonly taskId: string;
  readonly workloadRef: string;
  readonly args: readonly string[];
  readonly priority: 0 | 1 | 2 | 3;
  readonly signals: TaskSignals;
}

export interface ClassificationPolicy {
  readonly latencyThresholdMillis: number;
  readonly highMemoryThresholdBytes: number;
  readonly batchThreshold: number;
}

export interface TaskClassification {
  readonly taskClass: TaskClass;
  readonly reasons: readonly string[];
}

export interface CpuTopology {
  readonly architecture: string;
  readonly logicalThreads: number;
  readonly physicalCores: number;
  readonly memoryBytes: number;
}

export interface GpuDevice {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly memoryBytes: number;
  readonly computeCapability?: string;
}

export interface ComputeCapacity {
  readonly cpuCores: number;
  readonly memoryBytes: number;
  readonly gpuCount: number;
  readonly gpuMemoryBytes: number;
}

export interface RemoteCluster {
  readonly id: string;
  readonly region: string;
  readonly networkZone: string;
  readonly estimatedLatencyMillis: number;
  readonly capacity: ComputeCapacity;
  readonly supportsIsolation: boolean;
  readonly accelerators: readonly AcceleratorKind[];
}

export interface HardwareTopologySnapshot {
  readonly schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  readonly topologyVersion: string;
  readonly capturedAtEpochMs: number;
  readonly localCpu: CpuTopology;
  readonly localGpus: readonly GpuDevice[];
  readonly localIsolationModes: readonly IsolationMode[];
  readonly remoteClusters: readonly RemoteCluster[];
}

export interface HardwareTarget {
  readonly targetId: string;
  readonly backend: ExecutionBackend;
  readonly region: string;
  readonly networkZone: string;
  readonly estimatedLatencyMillis: number;
  readonly capacity: ComputeCapacity;
  readonly accelerator: AcceleratorKind;
  readonly supportsIsolation: boolean;
  readonly gpuIds: readonly string[];
  readonly score: number;
}

export interface TopologyResolution {
  readonly selected: HardwareTarget;
  readonly candidates: readonly HardwareTarget[];
}

export interface RuntimeLimits {
  readonly maxCpuCores: number;
  readonly maxCpuMillis: number;
  readonly maxMemoryBytes: number;
  readonly maxWallClockMillis: number;
  readonly maxGpuCount: number;
  readonly maxGpuMemoryBytes: number;
  readonly maxNetworkRequests: number;
  readonly maxArtifactBytes: number;
}

export interface RuntimeResourcePlan {
  readonly cpuCores: number;
  readonly cpuMillis: number;
  readonly memoryBytes: number;
  readonly wallClockMillis: number;
  readonly gpuCount: number;
  readonly gpuMemoryBytes: number;
  readonly networkRequests: number;
  readonly artifactBytes: number;
}

export interface SandboxPlan {
  readonly planVersion: typeof RUNTIME_SCHEMA_VERSION;
  readonly sandboxId: string;
  readonly isolationMode: IsolationMode;
  readonly networkMode: NetworkMode;
  readonly environmentAllowlist: readonly string[];
  readonly readOnlyPaths: readonly string[];
  readonly writablePaths: readonly string[];
  readonly deterministicSeed: string;
  readonly resourcePlanHash: string;
}

export interface ExecutionPlan {
  readonly planVersion: typeof RUNTIME_SCHEMA_VERSION;
  readonly taskId: string;
  readonly workloadRef: string;
  readonly args: readonly string[];
  readonly priority: 0 | 1 | 2 | 3;
  readonly classification: TaskClassification;
  readonly topology: TopologyResolution;
  readonly resources: RuntimeResourcePlan;
  readonly sandbox: SandboxPlan;
}

export interface RuntimeResourceUsage {
  readonly cpuMillis: number;
  readonly memoryBytes: number;
  readonly wallClockMillis: number;
  readonly gpuCount: number;
  readonly gpuMemoryBytes: number;
  readonly networkRequests: number;
  readonly artifactBytes: number;
}

export interface RuntimeVerification {
  readonly verified: boolean;
  readonly reasons: readonly string[];
}

export interface RuntimeExecutionObservation {
  readonly exitCode: number | null;
  readonly usage: RuntimeResourceUsage;
  readonly verification: RuntimeVerification;
  readonly outputDigest: string;
}

export interface RuntimeExecutionResult {
  readonly status: RuntimeStatus;
  readonly plan: ExecutionPlan;
  readonly observation: RuntimeExecutionObservation;
}

export interface RuntimeExecutor {
  execute(plan: ExecutionPlan): Promise<RuntimeExecutionObservation>;
}

export interface HardwareTopologyProvider {
  snapshot(): HardwareTopologySnapshot;
}

export interface RuntimeTopologyOptions {
  readonly classificationPolicy?: ClassificationPolicy;
  readonly limits?: RuntimeLimits;
}

export interface RuntimeFabricOptions extends RuntimeTopologyOptions {
  readonly topologyProvider: HardwareTopologyProvider;
  readonly executor: RuntimeExecutor;
}
