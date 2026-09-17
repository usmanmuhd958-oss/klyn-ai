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
    localIsolationModes: Object.freeze(["PROCESS", "CONTAINER"]),
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
  return Object.freeze({
    schemaVersion: "1.0.0",
    taskId: base.taskId,
    workloadRef: base.workloadRef,
    args: base.args,
    priority: base.priority,
    signals: Object.freeze({ ...base.signals, ...overrides }),
  });
}

type TaskSignalsShape = TaskSpec["signals"];

function observationFrom(plan: ExecutionPlan, patch: Partial<RuntimeExecutionObservation> = {}): RuntimeExecutionObservation {
  return {
    exitCode: 0,
    usage: {
      cpuMillis: plan.resources.cpuMillis,
      memoryBytes: plan.resources.memoryBytes,
      wallClockMillis: plan.resources.wallClockMillis,
      gpuCount: plan.resources.gpuCount,
      gpuMemoryBytes: plan.resources.gpuMemoryBytes,
      networkRequests: plan.resources.networkRequests,
      artifactBytes: plan.resources.artifactBytes,
    },
    verification: { verified: true, reasons: ["postcondition-check"] },
    outputDigest: "a".repeat(64),
    ...patch,
  };
}

test("P4-01 classify isolated work before all other classes", () => {
  const classifier = new TaskClassifier();
  const result = classifier.classify(task({ requiresIsolation: true }));
  assert.equal(result.taskClass, "ISOLATED_SANDBOX");
});

test("P4-02 classify latency-sensitive work", () => {
  const classifier = new TaskClassifier();
  const result = classifier.classify(task({ latencyBudgetMillis: 50 }));
  assert.equal(result.taskClass, "LATENCY_SENSITIVE");
});

test("P4-03 classify high-memory work", () => {
  const classifier = new TaskClassifier();
  const result = classifier.classify(task({ estimatedMemoryBytes: 32 * GB, latencyBudgetMillis: 10_000 }));
  assert.equal(result.taskClass, "HIGH_MEMORY");
});

test("P4-04 classify batch work", () => {
  const classifier = new TaskClassifier();
  const result = classifier.classify(task({ batchSize: 10_000, latencyBudgetMillis: 10_000 }));
  assert.equal(result.taskClass, "BATCH");
});

test("P4-05 latency work prefers local CPU when GPU is not required", () => {
  const resolver = new HardwareTopologyResolver();
  const classifier = new TaskClassifier();
  const current = task({ latencyBudgetMillis: 50 });
  const result = resolver.resolve(current, classifier.classify(current), topology());
  assert.equal(result.selected.targetId, "local-cpu");
});

test("P4-06 GPU work resolves to a local GPU target", () => {
  const resolver = new HardwareTopologyResolver();
  const classifier = new TaskClassifier();
  const current = task({
    latencyBudgetMillis: 50,
    preferredAccelerator: "GPU",
    requiresGpu: true,
    resourceRequest: { ...task().signals.resourceRequest, gpuCount: 1, minGpuMemoryBytes: 8 * GB },
  });
  const result = resolver.resolve(current, classifier.classify(current), topology());
  assert.equal(result.selected.targetId, "local-gpu:gpu0");
});

test("P4-07 high-memory work resolves to remote batch capacity", () => {
  const resolver = new HardwareTopologyResolver();
  const classifier = new TaskClassifier();
  const current = task({
    latencyBudgetMillis: 10_000,
    estimatedMemoryBytes: 128 * GB,
    resourceRequest: { ...task().signals.resourceRequest, maxMemoryBytes: 128 * GB },
  });
  const result = resolver.resolve(current, classifier.classify(current), topology());
  assert.equal(result.selected.targetId, "remote:batch");
});

test("P4-08 batch work prefers remote batch cluster deterministically", () => {
  const resolver = new HardwareTopologyResolver();
  const classifier = new TaskClassifier();
  const current = task({ batchSize: 100_000, latencyBudgetMillis: 10_000 });
  const first = resolver.resolve(current, classifier.classify(current), topology());
  const second = resolver.resolve(current, classifier.classify(current), topology());
  assert.equal(first.selected.targetId, "remote:batch");
  assert.equal(first.selected.targetId, second.selected.targetId);
});

test("P4-09 impossible hardware demand fails closed", () => {
  const resolver = new HardwareTopologyResolver();
  const classifier = new TaskClassifier();
  const current = task({
    estimatedMemoryBytes: 512 * GB,
    latencyBudgetMillis: 10_000,
    resourceRequest: { ...task().signals.resourceRequest, maxMemoryBytes: 512 * GB },
  });
  assert.throws(() => resolver.resolve(current, classifier.classify(current), topology()), RuntimeBoundaryViolation);
});

test("P4-10 runtime resource ceilings reject oversized requests", () => {
  const enforcer = new ResourceConstraintEnforcer({ ...DEFAULT_RUNTIME_LIMITS, maxMemoryBytes: 2 * GB });
  const current = task({ resourceRequest: { ...task().signals.resourceRequest, maxMemoryBytes: 4 * GB } });
  const resolver = new HardwareTopologyResolver();
  const target = resolver.resolve(current, new TaskClassifier().classify(current), topology()).selected;
  assert.throws(() => enforcer.enforce(current, target), RuntimeBoundaryViolation);
});

test("P4-11 sandbox identity is deterministic for identical inputs", () => {
  const planner = new DeterministicSandboxPlanner();
  const current = task();
  const resolver = new HardwareTopologyResolver();
  const target = resolver.resolve(current, new TaskClassifier().classify(current), topology()).selected;
  const resources = new ResourceConstraintEnforcer().enforce(current, target);
  assert.equal(planner.create(current, target, resources).sandboxId, planner.create(current, target, resources).sandboxId);
});

test("P4-12 sandbox identity changes when workload arguments change", () => {
  const planner = new DeterministicSandboxPlanner();
  const current = task();
  const changed = Object.freeze({ ...current, args: ["--mode", "different"] });
  const resolver = new HardwareTopologyResolver();
  const target = resolver.resolve(current, new TaskClassifier().classify(current), topology()).selected;
  const resources = new ResourceConstraintEnforcer().enforce(current, target);
  assert.notEqual(planner.create(current, target, resources).sandboxId, planner.create(changed, target, resources).sandboxId);
});

test("P4-13 isolated batch work resolves to a remote sandbox mode", () => {
  const resolver = new HardwareTopologyResolver();
  const classifier = new TaskClassifier();
  const current = task({ requiresIsolation: true, batchSize: 10_000, latencyBudgetMillis: 10_000 });
  const target = resolver.resolve(current, classifier.classify(current), topology()).selected;
  const resources = new ResourceConstraintEnforcer().enforce(current, target);
  const sandbox = new DeterministicSandboxPlanner().create(current, target, resources);
  assert.equal(target.targetId, "remote:batch");
  assert.equal(sandbox.isolationMode, "REMOTE_SANDBOX");
});

test("P4-14 fabric returns SUCCEEDED_VERIFIED only after postcondition verification", async () => {
  let receivedPlan: ExecutionPlan | null = null;
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: {
      async execute(plan) {
        receivedPlan = plan;
        return observationFrom(plan);
      },
    },
  });
  const result = await fabric.execute(task());
  assert.equal(result.status, "SUCCEEDED_VERIFIED");
  assert.notEqual(receivedPlan, null);
});

test("P4-15 unverified executor evidence cannot produce verified completion", async () => {
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: {
      async execute(plan) {
        return observationFrom(plan, { verification: { verified: false, reasons: ["missing-proof"] } });
      },
    },
  });
  const result = await fabric.execute(task());
  assert.equal(result.status, "UNVERIFIED");
});

test("P4-16 resource overrun cannot produce verified completion", async () => {
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: {
      async execute(plan) {
        return observationFrom(plan, { usage: { ...observationFrom(plan).usage, memoryBytes: plan.resources.memoryBytes + 1 } });
      },
    },
  });
  const result = await fabric.execute(task());
  assert.equal(result.status, "FAILED");
});

test("P4-17 nonzero exit cannot produce verified completion", async () => {
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: {
      async execute(plan) {
        return observationFrom(plan, { exitCode: 17 });
      },
    },
  });
  const result = await fabric.execute(task());
  assert.equal(result.status, "FAILED");
});

test("P4-18 malformed task input is rejected at the boundary", () => {
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: { async execute(plan) { return observationFrom(plan); } },
  });
  assert.throws(() => fabric.plan({ taskId: "missing-fields" }), RuntimeBoundaryViolation);
});

test("P4-19 malformed executor observation is rejected at the boundary", async () => {
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: {
      async execute() {
        return { exitCode: 0 } as RuntimeExecutionObservation;
      },
    },
  });
  await assert.rejects(() => fabric.execute(task()), RuntimeBoundaryViolation);
});

test("P4-20 malformed topology arrays fail with a typed boundary error", () => {
  const malformed = { ...topology(), localGpus: "not-an-array" } as unknown as HardwareTopologySnapshot;
  assert.throws(() => new StaticHardwareTopologyProvider(malformed).snapshot(), RuntimeBoundaryViolation);
});

test("P4-21 incoherent required GPU resource request fails at task validation", () => {
  const fabric = new RuntimeExecutionFabric({
    topologyProvider: new StaticHardwareTopologyProvider(topology()),
    executor: { async execute(plan) { return observationFrom(plan); } },
  });
  assert.throws(
    () => fabric.plan(task({ requiresGpu: true })),
    (error: unknown) => error instanceof RuntimeBoundaryViolation && error.code === "RESOURCE_MISMATCH",
  );
});
