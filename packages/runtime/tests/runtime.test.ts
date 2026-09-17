import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_RUNTIME_LIMITS,
  HardwareTopologyResolver,
  ResourceConstraintEnforcer,
  RuntimeBoundaryViolation,
  RuntimeExecutionFabric,
  StaticHardwareTopologyProvider,
  TaskClassifier,
  DeterministicSandboxPlanner,
  type ExecutionPlan,
  type HardwareTopologySnapshot,
  type RuntimeExecutionObservation,
  type TaskSpec,
} from "../src/index.js";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function topology(): HardwareTopologySnapshot {
  return Object.freeze({
    schemaVersion: "1.0.0",
    topologyVersion: "test-v1",
    capturedAtEpochMs: 1_700_000_000_000,
    localCpu: Object.freeze({ architecture: "x64", logicalThreads: 8, physicalCores: 4, memoryBytes: 32 * GB }),
    localGpus: Object.freeze([
      Object.freeze({ id: "gpu0", vendor: "TestGPU", model: "T24", memoryBytes: 24 * GB }),
    ]),
    localIsolationModes: Object.freeze(["PROCESS", "CONTAINER"] as const),
    remoteClusters: Object.freeze([
      Object.freeze({
        id: "lowlat",
        region: "eu-west",
        networkZone: "trusted",
        estimatedLatencyMillis: 20,
        capacity: Object.freeze({ cpuCores: 16, memoryBytes: 64 * GB, gpuCount: 2, gpuMemoryBytes: 48 * GB }),
        isolationModes: Object.freeze(["REMOTE_SANDBOX"]),
        accelerators: Object.freeze(["CPU", "GPU"]),
      }),
      Object.freeze({
        id: "batch",
        region: "us-east",
        networkZone: "batch",
        estimatedLatencyMillis: 80,
        capacity: Object.freeze({ cpuCores: 64, memoryBytes: 256 * GB, gpuCount: 4, gpuMemoryBytes: 96 * GB }),
        isolationModes: Object.freeze(["REMOTE_SANDBOX", "CONTAINER"]),
        accelerators: Object.freeze(["CPU", "GPU"]),
      }),
    ]),
  });
}

function task(overrides: Partial<TaskSignalsShape> = {}): TaskSpec {
  const base = {
    taskId: "task-1",
    workloadRef: "workload:test",
    args: ["--mode", "test"],
    priority: 1 as const,
    signals: {
      estimatedCpuMillis: 1_000,
      estimatedMemoryBytes: 512 * MB,
      latencyBudgetMillis: 1_000,
      batchSize: 1,
      requiresIsolation: false,
      preferredAccelerator: "NONE" as const,
      requiresGpu: false,
      requiresNetwork: false,
      resourceRequest: {
        minCpuCores: 1,
        maxCpuMillis: 5_000,
        maxMemoryBytes: 1 * GB,
        maxWallClockMillis: 10_000,
        gpuCount: 0,
        minGpuMemoryBytes: 0,
        maxNetworkRequests: 0,
        maxArtifactBytes: 1 * MB,
      },
    },
  };