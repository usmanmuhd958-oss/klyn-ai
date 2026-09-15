export type AgentTaskStatus = "pending" | "running" | "succeeded" | "failed" | "rolled_back";

export interface AgentTaskContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
}

export interface AgentTask {
  readonly id: string;
  readonly agentId: string;
  readonly input: unknown;
  readonly dependsOn?: readonly string[];
  readonly run: (context: AgentTaskContext) => Promise<unknown>;
  readonly rollback?: (context: AgentTaskContext, error: unknown) => Promise<void>;
}

export interface DagSnapshot {
  readonly statuses: Readonly<Record<string, AgentTaskStatus>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, string>>;
}

export interface DagExecutionOptions {
  readonly maxConcurrency?: number;
  readonly failFast?: boolean;
}

export class DagValidationError extends Error {
  constructor(message: string) { super(message); this.name = "DagValidationError"; }
}

export class SwarmDagOrchestrator {
  private readonly tasks = new Map<string, AgentTask>();

  addTask(task: AgentTask): this {
    if (this.tasks.has(task.id)) throw new DagValidationError(`Duplicate task id: ${task.id}`);
    this.tasks.set(task.id, task);
    return this;
  }

  addTasks(tasks: readonly AgentTask[]): this { for (const task of tasks) this.addTask(task); return this; }

  validate(): void { this.validateDependenciesOnly(); this.topologicalSort(); }

  topologicalSort(): string[][] {
    this.validateDependenciesOnly();
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const id of this.tasks.keys()) { indegree.set(id, 0); outgoing.set(id, []); }
    for (const task of this.tasks.values()) for (const dependency of task.dependsOn ?? []) {
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      outgoing.get(dependency)!.push(task.id);
    }
    const layers: string[][] = [];
    let ready = [...this.tasks.keys()].filter((id) => indegree.get(id) === 0);
    let visited = 0;
    while (ready.length) {
      const layer = [...ready].sort();
      layers.push(layer); visited += layer.length;
      const next: string[] = [];
      for (const id of layer) for (const child of outgoing.get(id)!) {
        const value = indegree.get(child)! - 1;
        indegree.set(child, value);
        if (value === 0) next.push(child);
      }
      ready = next;
    }
    if (visited !== this.tasks.size) throw new DagValidationError("DAG contains a cycle");
    return layers;
  }

  async execute(options: DagExecutionOptions = {}): Promise<DagSnapshot> {
    this.validate();
    const maxConcurrency = Number.isFinite(options.maxConcurrency) ? Math.max(1, Math.floor(options.maxConcurrency!)) : Number.MAX_SAFE_INTEGER;
    const statuses: Record<string, AgentTaskStatus> = {};
    const outputs: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const id of this.tasks.keys()) statuses[id] = "pending";
    const completed: string[] = [];
    const contextFor = (task: AgentTask): AgentTaskContext => ({ taskId: task.id, agentId: task.agentId, input: task.input, outputs: { ...outputs } });

    try {
      for (const layer of this.topologicalSort()) {
        for (let offset = 0; offset < layer.length; offset += maxConcurrency) {
          const batch = layer.slice(offset, offset + maxConcurrency);
          const results = await Promise.all(batch.map(async (id) => {
            const task = this.tasks.get(id)!; statuses[id] = "running";
            try {
              outputs[id] = await task.run(contextFor(task));
              statuses[id] = "succeeded"; completed.push(id);
              return { id, ok: true as const };
            } catch (error) {
              statuses[id] = "failed"; errors[id] = error instanceof Error ? error.message : String(error);
              return { id, ok: false as const, error };
            }
          }));
          const failure = results.find((result) => !result.ok);
          if (failure && (options.failFast ?? true)) throw failure.error;
        }
      }
    } catch (error) {
      await this.rollback(completed, statuses, outputs, errors, error);
      throw error;
    }
    return { statuses: { ...statuses }, outputs: { ...outputs }, errors: { ...errors } };
  }

  private async rollback(completed: readonly string[], statuses: Record<string, AgentTaskStatus>, outputs: Record<string, unknown>, errors: Record<string, string>, cause: unknown): Promise<void> {
    for (const id of [...completed].reverse()) {
      const task = this.tasks.get(id)!;
      if (!task.rollback) continue;
      try {
        await task.rollback({ taskId: task.id, agentId: task.agentId, input: task.input, outputs: { ...outputs } }, cause);
        statuses[id] = "rolled_back"; delete outputs[id];
      } catch (rollbackError) { errors[`${id}:rollback`] = rollbackError instanceof Error ? rollbackError.message : String(rollbackError); }
    }
  }

  private validateDependenciesOnly(): void {
    for (const task of this.tasks.values()) for (const dependency of task.dependsOn ?? []) {
      if (!this.tasks.has(dependency)) throw new DagValidationError(`Unknown dependency ${dependency} for task ${task.id}`);
    }
  }
}
