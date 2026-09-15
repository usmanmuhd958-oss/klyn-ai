import { createHash } from "node:crypto";

export type AgentTaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rolled_back"
  | "cancelled"
  | "blocked";

export interface AgentTaskContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}

export interface AgentTask {
  readonly id: string;
  readonly agentId: string;
  readonly input: unknown;
  readonly dependsOn?: readonly string[];
  readonly run: (context: AgentTaskContext, signal?: AbortSignal) => Promise<unknown>;
  readonly rollback?: (context: AgentTaskContext, error: unknown) => Promise<void>;
}

export interface DagSnapshot {
  readonly statuses: Readonly<Record<string, AgentTaskStatus>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly idempotencyKeys: Readonly<Record<string, string>>;
}

export interface DagExecutionOptions {
  readonly maxConcurrency?: number;
  readonly failFast?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class DagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DagValidationError";
  }
}

export class DagCancelledError extends Error {
  constructor(message = "DAG execution cancelled") {
    super(message);
    this.name = "DagCancelledError";
  }
}

export class DagTimeoutError extends Error {
  constructor(taskId: string, ms: number) {
    super(`Task ${taskId} timed out after ${ms}ms`);
    this.name = "DagTimeoutError";
  }
}

export function deterministicIdempotencyKey(
  task: Pick<AgentTask, "id" | "agentId" | "input" | "dependsOn">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: task.id,
        agentId: task.agentId,
        input: task.input,
        dependsOn: [...(task.dependsOn ?? [])].sort(),
      }),
    )
    .digest("hex");
}

export class SwarmDagOrchestrator {
  private readonly tasks = new Map<string, AgentTask>();

  addTask(task: AgentTask): this {
    if (this.tasks.has(task.id)) {
      throw new DagValidationError(`Duplicate task id: ${task.id}`);
    }
    this.tasks.set(task.id, task);
    return this;
  }

  addTasks(tasks: readonly AgentTask[]): this {
    for (const task of tasks) this.addTask(task);
    return this;
  }

  validate(): void {
    this.validateDependenciesOnly();
    this.topologicalSort();
  }

  /** Deterministic Kahn topological sort. Each layer contains independent work. */
  topologicalSort(): string[][] {
    this.validateDependenciesOnly();

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const id of this.tasks.keys()) {
      indegree.set(id, 0);
      outgoing.set(id, []);
    }

    for (const task of this.tasks.values()) {
      for (const dependency of task.dependsOn ?? []) {
        indegree.set(task.id, indegree.get(task.id)! + 1);
        outgoing.get(dependency)!.push(task.id);
      }
    }

    for (const children of outgoing.values()) children.sort();

    const layers: string[][] = [];
    let ready = [...this.tasks.keys()]
      .filter((id) => indegree.get(id) === 0)
      .sort();
    let visited = 0;

    while (ready.length > 0) {
      const layer = [...ready];
      layers.push(layer);
      visited += layer.length;
      const next: string[] = [];

      for (const id of layer) {
        for (const child of outgoing.get(id)!) {
          const remaining = indegree.get(child)! - 1;
          indegree.set(child, remaining);
          if (remaining === 0) next.push(child);
        }
      }

      ready = next.sort();
    }

    if (visited !== this.tasks.size) {
      throw new DagValidationError("DAG contains a cycle");
    }

    return layers;
  }

  async execute(options: DagExecutionOptions = {}): Promise<DagSnapshot> {
    this.validate();

    const limit = Number.isFinite(options.maxConcurrency)
      ? Math.max(1, Math.floor(options.maxConcurrency!))
      : Number.MAX_SAFE_INTEGER;
    const failFast = options.failFast ?? true;
    const statuses: Record<string, AgentTaskStatus> = {};
    const outputs: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    const idempotencyKeys: Record<string, string> = {};

    for (const task of this.tasks.values()) {
      statuses[task.id] = "pending";
      idempotencyKeys[task.id] = deterministicIdempotencyKey(task);
    }

    const completed: string[] = [];
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason ?? new DagCancelledError());

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    const contextFor = (task: AgentTask): AgentTaskContext => ({
      taskId: task.id,
      agentId: task.agentId,
      input: task.input,
      outputs: { ...outputs },
      idempotencyKey: idempotencyKeys[task.id],
      signal: controller.signal,
    });

    try {
      for (const layer of this.topologicalSort()) {
        for (let i = 0; i < layer.length; i += limit) {
          if (controller.signal.aborted) throw new DagCancelledError();

          const batch = layer.slice(i, i + limit);
          for (const id of batch) statuses[id] = "queued";

          const results = await Promise.all(
            batch.map(async (id) => {
              const task = this.tasks.get(id)!;
              const dependencyFailed = (task.dependsOn ?? []).some(
                (dependency) => statuses[dependency] !== "succeeded",
              );

              if (dependencyFailed) {
                statuses[id] = "skipped";
                errors[id] = "dependency did not succeed";
                return { id, ok: false as const, error: new Error(errors[id]) };
              }

              statuses[id] = "running";
              try {
                outputs[id] = await this.run(
                  task,
                  contextFor(task),
                  options.timeoutMs,
                  controller.signal,
                );
                statuses[id] = "succeeded";
                completed.push(id);
                return { id, ok: true as const };
              } catch (error) {
                statuses[id] = controller.signal.aborted ? "cancelled" : "failed";
                errors[id] = error instanceof Error ? error.message : String(error);
                if (failFast) controller.abort(error);
                return { id, ok: false as const, error };
              }
            }),
          );

          const failure = results.find((result) => !result.ok);
          if (failure && failFast) throw failure.error;
        }
      }
    } catch (error) {
      await this.rollback(completed, statuses, outputs, errors, error, controller.signal);
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }

    return {
      statuses: { ...statuses },
      outputs: { ...outputs },
      errors: { ...errors },
      idempotencyKeys: { ...idempotencyKeys },
    };
  }

  private async run(
    task: AgentTask,
    context: AgentTaskContext,
    timeoutMs: number | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!timeoutMs || timeoutMs <= 0) return task.run(context, signal);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new DagTimeoutError(task.id, timeoutMs));
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new DagCancelledError());
      };
      signal.addEventListener("abort", onAbort, { once: true });

      task.run(context, signal).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private async rollback(
    completed: readonly string[],
    statuses: Record<string, AgentTaskStatus>,
    outputs: Record<string, unknown>,
    errors: Record<string, string>,
    cause: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    for (const id of [...completed].reverse()) {
      const task = this.tasks.get(id)!;
      if (!task.rollback) continue;
      try {
        await task.rollback(
          {
            taskId: task.id,
            agentId: task.agentId,
            input: task.input,
            outputs: { ...outputs },
            idempotencyKey: deterministicIdempotencyKey(task),
            signal,
          },
          cause,
        );
        statuses[id] = "rolled_back";
        delete outputs[id];
      } catch (error) {
        errors[`${id}:rollback`] = error instanceof Error ? error.message : String(error);
      }
    }
  }

  private validateDependenciesOnly(): void {
    for (const task of this.tasks.values()) {
      for (const dependency of task.dependsOn ?? []) {
        if (!this.tasks.has(dependency)) {
          throw new DagValidationError(`Unknown dependency ${dependency} for task ${task.id}`);
        }
      }
    }
  }
}
