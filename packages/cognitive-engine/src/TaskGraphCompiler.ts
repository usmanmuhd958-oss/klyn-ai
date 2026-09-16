import { TaskGraphBuilder, TopologicalResolver, type GraphTask, type ResolvedGraph } from "./dynamic-dag.js";
import type { Constraint, Dependency, IntentSpec } from "./IntentSpec.js";
import { WorldModelBuilder, type EpistemicWorldModel } from "./WorldModel.js";

export type IntentTaskKind = "OBJECTIVE" | "DEPENDENCY" | "CONSTRAINT_CHECK" | "ACCEPTANCE_CHECK" | "EVIDENCE_CHECK";

export interface IntentTaskInput {
  readonly intentId: string;
  readonly kind: IntentTaskKind;
  readonly sourceId: string;
  readonly description: string;
}

export interface IntentGraphTask extends GraphTask<IntentTaskInput> {
  readonly kind: IntentTaskKind;
  readonly sourceId: string;
}

export interface CompiledTaskGraph {
  readonly intentId: string;
  readonly contentHash: string;
  readonly worldModel: EpistemicWorldModel;
  readonly tasks: readonly IntentGraphTask[];
  readonly resolution: ResolvedGraph<IntentGraphTask>;
}

export class TaskGraphCompilationError extends Error {
  readonly code = "TASK_GRAPH_COMPILATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "TaskGraphCompilationError";
  }
}

export class TaskGraphCompiler {
  private readonly worldModelBuilder: WorldModelBuilder;

  constructor(worldModelBuilder: WorldModelBuilder = new WorldModelBuilder()) {
    this.worldModelBuilder = worldModelBuilder;
  }

  compile(intent: IntentSpec): CompiledTaskGraph {
    if (intent.state !== "FROZEN" && intent.state !== "EXECUTABLE") {
      throw new TaskGraphCompilationError(`Intent ${intent.intentId} is not executable from state ${intent.state}`);
    }

    const worldModel = this.worldModelBuilder.build(intent);
    const tasks: IntentGraphTask[] = [];

    for (const dependency of intent.dependencies) tasks.push(this.dependencyTask(intent, dependency));
    tasks.push(this.objectiveTask(intent));
    for (const constraint of intent.constraints) tasks.push(this.constraintTask(intent, constraint));
    for (const criterion of intent.acceptanceCriteria) {
      tasks.push({
        id: `acceptance:${criterion.id}`,
        kind: "ACCEPTANCE_CHECK",
        sourceId: criterion.id,
        dependsOn: [`objective:${intent.intentId}`],
        input: { intentId: intent.intentId, kind: "ACCEPTANCE_CHECK", sourceId: criterion.id, description: criterion.description },
      });
    }
    for (const evidence of intent.requiredEvidence) {
      tasks.push({
        id: `evidence:${evidence.id}`,
        kind: "EVIDENCE_CHECK",
        sourceId: evidence.id,
        dependsOn: [`objective:${intent.intentId}`],
        input: { intentId: intent.intentId, kind: "EVIDENCE_CHECK", sourceId: evidence.id, description: evidence.description },
      });
    }

    const graph = new TaskGraphBuilder<IntentGraphTask>().addMany(tasks).build();
    this.assertDependencyIntegrity(graph);
    const resolution = new TopologicalResolver<IntentGraphTask>().resolve(graph);
    return Object.freeze({
      intentId: intent.intentId,
      contentHash: intent.contentHash,
      worldModel,
      tasks: Object.freeze(graph),
      resolution: Object.freeze({
        order: Object.freeze(resolution.order),
        layers: Object.freeze(resolution.layers.map((layer) => Object.freeze(layer))),
      }),
    });
  }

  private objectiveTask(intent: IntentSpec): IntentGraphTask {
    return {
      id: `objective:${intent.intentId}`,
      kind: "OBJECTIVE",
      sourceId: intent.intentId,
      dependsOn: intent.dependencies.map((dependency) => `dependency:${dependency.id}`),
      input: { intentId: intent.intentId, kind: "OBJECTIVE", sourceId: intent.intentId, description: intent.objective.outcome },
    };
  }

  private dependencyTask(intent: IntentSpec, dependency: Dependency): IntentGraphTask {
    return {
      id: `dependency:${dependency.id}`,
      kind: "DEPENDENCY",
      sourceId: dependency.id,
      dependsOn: dependency.dependsOn.map((id) => `dependency:${id}`),
      input: { intentId: intent.intentId, kind: "DEPENDENCY", sourceId: dependency.id, description: dependency.name },
    };
  }

  private constraintTask(intent: IntentSpec, constraint: Constraint): IntentGraphTask {
    return {
      id: `constraint:${constraint.id}`,
      kind: "CONSTRAINT_CHECK",
      sourceId: constraint.id,
      dependsOn: [`objective:${intent.intentId}`],
      input: { intentId: intent.intentId, kind: "CONSTRAINT_CHECK", sourceId: constraint.id, description: constraint.statement },
    };
  }

  private assertDependencyIntegrity(tasks: readonly IntentGraphTask[]): void {
    const ids = new Set(tasks.map((task) => task.id));
    for (const task of tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!ids.has(dependency)) throw new TaskGraphCompilationError(`Task ${task.id} references missing node ${dependency}`);
        if (dependency === task.id) throw new TaskGraphCompilationError(`Task ${task.id} cannot depend on itself`);
      }
    }
  }
}
