export interface GraphTask<TInput = unknown> {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly input?: TInput;
}

export class TaskGraphBuilder<TTask extends GraphTask = GraphTask> {
  private readonly nodes = new Map<string, TTask>();

  add(task: TTask): this {
    if (!task.id) throw new Error("Task id is required");
    if (this.nodes.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    this.nodes.set(task.id, task);
    return this;
  }

  addMany(tasks: readonly TTask[]): this {
    for (const task of tasks) this.add(task);
    return this;
  }

  build(): readonly TTask[] {
    for (const task of this.nodes.values()) {
      for (const dependency of task.dependsOn ?? []) {
        if (!this.nodes.has(dependency)) {
          throw new Error(`Unknown dependency ${dependency} for task ${task.id}`);
        }
      }
    }
    return [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export interface ResolvedGraph<TTask extends GraphTask = GraphTask> {
  readonly order: readonly string[];
  readonly layers: readonly (readonly TTask[])[];
}

export class TopologicalResolver<TTask extends GraphTask = GraphTask> {
  resolve(tasks: readonly TTask[]): ResolvedGraph<TTask> {
    const byId = new Map(tasks.map((task) => [task.id, task] as const));
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const task of tasks) {
      indegree.set(task.id, 0);
      outgoing.set(task.id, []);
    }
    for (const task of tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!byId.has(dependency)) throw new Error(`Unknown dependency ${dependency} for task ${task.id}`);
        indegree.set(task.id, indegree.get(task.id)! + 1);
        outgoing.get(dependency)!.push(task.id);
      }
    }
    for (const children of outgoing.values()) children.sort();
    let ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
    const layers: string[][] = [];
    const order: string[] = [];
    while (ready.length) {
      const layer = [...ready];
      layers.push(layer);
      const next: string[] = [];
      for (const id of layer) {
        order.push(id);
        for (const child of outgoing.get(id)!) {
          const degree = indegree.get(child)! - 1;
          indegree.set(child, degree);
          if (degree === 0) next.push(child);
        }
      }
      ready = next.sort();
    }
    if (order.length !== tasks.length) {
      const cycle = this.findCycle(tasks);
      throw new Error(`DAG cycle detected${cycle.length ? `: ${cycle.join(" -> ")}` : ""}`);
    }
    return { order, layers: layers.map((layer) => layer.map((id) => byId.get(id)!)) };
  }

  private findCycle(tasks: readonly TTask[]): readonly string[] {
    const graph = new Map(tasks.map((task) => [task.id, [...(task.dependsOn ?? [])]] as const));
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    let nextIndex = 0;
    let component: string[] = [];
    const visit = (id: string): void => {
      index.set(id, nextIndex); low.set(id, nextIndex++); stack.push(id); onStack.add(id);
      for (const dep of graph.get(id) ?? []) {
        if (!index.has(dep)) { visit(dep); low.set(id, Math.min(low.get(id)!, low.get(dep)!)); }
        else if (onStack.has(dep)) low.set(id, Math.min(low.get(id)!, index.get(dep)!));
      }
      if (low.get(id) === index.get(id)) {
        const members: string[] = [];
        let current = "";
        do { current = stack.pop()!; onStack.delete(current); members.push(current); } while (current !== id);
        if (members.length > 1 || (graph.get(id) ?? []).includes(id)) component = members.sort();
      }
    };
    for (const task of tasks) if (!index.has(task.id)) visit(task.id);
    return component;
  }
}

export interface GraphExecutionTask<TInput = unknown, TResult = unknown> extends GraphTask<TInput> {
  readonly run: (input: TInput | undefined, signal: AbortSignal) => Promise<TResult>;
  readonly rollback?: (result: TResult, reason: unknown) => Promise<void>;
}

export interface GraphExecutionResult<TResult = unknown> {
  readonly status: Readonly<Record<string, "succeeded" | "failed" | "skipped" | "rolled_back">>;
  readonly outputs: Readonly<Record<string, TResult>>;
  readonly errors: Readonly<Record<string, string>>;
}

export interface GraphExecutionOptions { readonly maxConcurrency?: number; readonly signal?: AbortSignal; }

export class GraphExecutionEngine<TTask extends GraphExecutionTask = GraphExecutionTask> {
  async execute(tasks: readonly TTask[], options: GraphExecutionOptions = {}): Promise<GraphExecutionResult> {
    const graph = new TaskGraphBuilder<TTask>().addMany(tasks).build();
    const resolved = new TopologicalResolver<TTask>().resolve(graph);
    const status: Record<string, "succeeded" | "failed" | "skipped" | "rolled_back"> = {};
    const outputs: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const limit = Number.isFinite(options.maxConcurrency) ? Math.max(1, Math.floor(options.maxConcurrency!)) : Number.MAX_SAFE_INTEGER;
    const succeeded: TTask[] = [];
    try {
      for (const layer of resolved.layers) {
        if (controller.signal.aborted) throw new Error("Graph execution cancelled");
        const runnable = layer.filter((task) => (task.dependsOn ?? []).every((id) => status[id] === "succeeded"));
        for (const task of layer) if (!runnable.includes(task)) { status[task.id] = "skipped"; errors[task.id] = "dependency did not succeed"; }
        for (let offset = 0; offset < runnable.length; offset += limit) {
          const batch = runnable.slice(offset, offset + limit);
          const settled = await Promise.all(batch.map(async (task) => {
            try {
              status[task.id] = "succeeded";
              const result = await task.run(task.input, controller.signal);
              outputs[task.id] = result;
              succeeded.push(task);
              return true;
            } catch (error) {
              status[task.id] = "failed";
              errors[task.id] = error instanceof Error ? error.message : String(error);
              return false;
            }
          }));
          if (settled.some((ok) => !ok)) {
            for (const descendant of graph.filter((task) => task.dependsOn?.some((id) => status[id] === "failed"))) {
              if (!status[descendant.id]) { status[descendant.id] = "skipped"; errors[descendant.id] = "dependency did not succeed"; }
            }
            throw new Error("Graph execution failed");
          }
        }
      }
      return { status, outputs, errors };
    } catch (error) {
      controller.abort(error);
      for (const task of [...succeeded].reverse()) {
        const result = outputs[task.id];
        if (!task.rollback || result === undefined) continue;
        try { await task.rollback(result, error); status[task.id] = "rolled_back"; delete outputs[task.id]; }
        catch (rollbackError) { errors[`${task.id}:rollback`] = rollbackError instanceof Error ? rollbackError.message : String(rollbackError); }
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}
