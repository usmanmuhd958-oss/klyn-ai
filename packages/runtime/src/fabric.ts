import type {
  ExecutionPlan,
  RuntimeExecutionObservation,
  RuntimeExecutionResult,
  RuntimeFabricOptions,
  RuntimeResourceUsage,
  RuntimeStatus,
  TaskSpec,
} from "./types.js";
import { TaskClassifier, DEFAULT_CLASSIFICATION_POLICY } from "./classifier.js";
import { HardwareTopologyResolver } from "./topology.js";
import { ResourceConstraintEnforcer, DEFAULT_RUNTIME_LIMITS } from "./resource-enforcer.js";
import { DeterministicSandboxPlanner, DEFAULT_SANDBOX_POLICY } from "./sandbox.js";
import { RuntimeBoundaryViolation, freezeDeep, parseTaskSpec, validateTopology } from "./validation.js";

function usageWithinPlan(usage: RuntimeResourceUsage, plan: ExecutionPlan): boolean {
  return (
    usage.cpuMillis <= plan.resources.cpuMillis &&
    usage.memoryBytes <= plan.resources.memoryBytes &&
    usage.wallClockMillis <= plan.resources.wallClockMillis &&
    usage.gpuCount <= plan.resources.gpuCount &&
    usage.gpuMemoryBytes <= plan.resources.gpuMemoryBytes &&
    usage.networkRequests <= plan.resources.networkRequests &&
    usage.artifactBytes <= plan.resources.artifactBytes
  );
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function evaluateStatus(observation: RuntimeExecutionObservation, plan: ExecutionPlan): RuntimeStatus {
  if (!usageWithinPlan(observation.usage, plan)) return "FAILED";
  if (observation.exitCode !== 0) return "FAILED";
  if (!validDigest(observation.outputDigest)) return "UNVERIFIED";
  if (!observation.verification.verified) return "UNVERIFIED";
  return "SUCCEEDED_VERIFIED";
}

export class RuntimeExecutionFabric {
  private readonly classifier: TaskClassifier;
  private readonly topologyResolver = new HardwareTopologyResolver();
  private readonly resourceEnforcer: ResourceConstraintEnforcer;
  private readonly sandboxPlanner = new DeterministicSandboxPlanner(DEFAULT_SANDBOX_POLICY);

  constructor(private readonly options: RuntimeFabricOptions) {
    this.classifier = new TaskClassifier(options.classificationPolicy ?? DEFAULT_CLASSIFICATION_POLICY);
    this.resourceEnforcer = new ResourceConstraintEnforcer(options.limits ?? DEFAULT_RUNTIME_LIMITS);
  }

  plan(input: unknown): ExecutionPlan {
    const task = parseTaskSpec(input);
    const classification = this.classifier.classify(task);
    const topology = validateTopology(this.options.topologyProvider.snapshot());
    const resolution = this.topologyResolver.resolve(task, classification, topology);
    const resources = this.resourceEnforcer.enforce(task, resolution.selected);
    const sandbox = this.sandboxPlanner.create(task, resolution.selected, resources);
    return freezeDeep({
      planVersion: "1.0.0",
      taskId: task.taskId,
      workloadRef: task.workloadRef,
      args: [...task.args],
      priority: task.priority,
      classification,
      topology: resolution,
      resources,
      sandbox,
    });
  }

  async execute(input: unknown): Promise<RuntimeExecutionResult> {
    const plan = this.plan(input);
    if (!this.sandboxPlanner.verify(plan.sandbox, plan)) {
      throw new RuntimeBoundaryViolation("SANDBOX_IDENTITY", "Sandbox plan identity verification failed");
    }
    const observation = freezeDeep(await this.options.executor.execute(plan));
    const status = evaluateStatus(observation, plan);
    return freezeDeep({ status, plan, observation });
  }
}
