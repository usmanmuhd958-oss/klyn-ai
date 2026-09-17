import type {
  ClassificationPolicy,
  TaskClassification,
  TaskSpec,
} from "./types.js";
import { freezeDeep } from "./validation.js";

export const DEFAULT_CLASSIFICATION_POLICY: ClassificationPolicy = freezeDeep({
  latencyThresholdMillis: 150,
  highMemoryThresholdBytes: 16 * 1024 * 1024 * 1024,
  batchThreshold: 1_000,
});

export class TaskClassifier {
  constructor(
    private readonly policy: ClassificationPolicy = DEFAULT_CLASSIFICATION_POLICY,
  ) {}

  classify(task: TaskSpec): TaskClassification {
    const reasons: string[] = [];
    if (task.signals.requiresIsolation) {
      reasons.push("task requires an isolated sandbox");
      return freezeDeep({ taskClass: "ISOLATED_SANDBOX", reasons });
    }

    if (
      task.signals.latencyBudgetMillis !== undefined &&
      task.signals.latencyBudgetMillis <= this.policy.latencyThresholdMillis
    ) {
      reasons.push(`latency budget <= ${this.policy.latencyThresholdMillis}ms`);
      return freezeDeep({ taskClass: "LATENCY_SENSITIVE", reasons });
    }

    if (task.signals.estimatedMemoryBytes >= this.policy.highMemoryThresholdBytes) {
      reasons.push(`estimated memory >= ${this.policy.highMemoryThresholdBytes} bytes`);
      return freezeDeep({ taskClass: "HIGH_MEMORY", reasons });
    }

    if ((task.signals.batchSize ?? 1) >= this.policy.batchThreshold) {
      reasons.push(`batch size >= ${this.policy.batchThreshold}`);
      return freezeDeep({ taskClass: "BATCH", reasons });
    }

    if (task.signals.preferredAccelerator === "GPU" || task.signals.requiresGpu) {
      reasons.push("accelerator demand defaults to latency-sensitive scheduling");
    } else {
      reasons.push("interactive/default workload uses latency-sensitive scheduling");
    }
    return freezeDeep({ taskClass: "LATENCY_SENSITIVE", reasons });
  }
}
