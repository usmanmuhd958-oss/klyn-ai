export type SwarmTaskState =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";

export interface SwarmTask<TOutput = unknown> {
  readonly id: string;
  readonly agentId: string;
  readonly dependsOn?: readonly string[];
  readonly maxAttempts?: number;
  readonly execute: (context: SwarmExecutionContext) => Promise<TOutput>;
}

export interface SwarmExecutionContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly dependencyOutputs: Readonly<Record<string, unknown>>;
}

export interface SwarmTaskSnapshot {
  readonly id: string;
  readonly agentId: string;
  readonly state: SwarmTaskState;
  readonly attempt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly error?: string;
  readonly output?: unknown;
}

export interface SwarmSnapshot {
  readonly executionId: string;
  readonly states: Readonly<Record<string, SwarmTaskSnapshot>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly eventLog: readonly SwarmStateEvent[];
}

export interface SwarmStateEvent {
  readonly sequence: number;
  readonly taskId: string;
  readonly from: SwarmTaskState;
  readonly to: SwarmTaskState;
  readonly timestamp: number;
  readonly error?: string;
}

export interface SwarmRunOptions {
  readonly maxConcurrency?: number;
  readonly failFast?: boolean;
  readonly signal?: AbortSignal;
}

export interface SwarmRunResult {
  readonly executionId: string;
  readonly succeeded: readonly string[];
  readonly failed: readonly string[];
  readonly cancelled: readonly string[];
  readonly blocked: readonly string[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly snapshot: SwarmSnapshot;
}

interface MutableTaskState {
  readonly task: SwarmTask;
  state: SwarmTaskState;
  attempt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  output?: unknown;
}

const TERMINAL_STATES = new Set<SwarmTaskState>([
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
]);

const TRANSITIONS: Readonly<Record<SwarmTaskState, readonly SwarmTaskState[]>> = {
  pending: ["ready", "cancelled", "blocked"],
  ready: ["running", "cancelled", "blocked"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  blocked: [],
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateUniqueIds<TOutput>(tasks: readonly SwarmTask<TOutput>[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id.trim()) throw new Error("Swarm task id must be non-empty");
    if (!task.agentId.trim()) throw new Error(`Swarm task ${task.id} requires an agentId`);
    if (ids.has(task.id)) throw new Error(`Duplicate swarm task id: ${task.id}`);
    ids.add(task.id);
    if (task.maxAttempts !== undefined && (!Number.isInteger(task.maxAttempts) || task.maxAttempts <= 0)) {
      throw new Error(`Task ${task.id} maxAttempts must be a positive integer`);
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`Task ${task.id} depends on unknown task: ${dependency}`);
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
    }
  }
}

function validateAcyclic<TOutput>(tasks: readonly SwarmTask<TOutput>[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Swarm task graph contains a cycle at ${id}`);
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    visiting.add(id);
    for (const dependency of task.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of tasks) visit(task.id);
}

function createExecutionId(): string {
  return `swarm-${Date.now()}-${crypto.randomUUID()}`;
}

export class SwarmStateMachine<TOutput = unknown> {
  private readonly executionId: string;
  private readonly tasks = new Map<string, MutableTaskState>();
  private readonly outputs = new Map<string, unknown>();
  private readonly events: SwarmStateEvent[] = [];
  private eventSequence = 0;
  private readonly controller = new AbortController();

  public constructor(tasks: readonly SwarmTask<TOutput>[], executionId = createExecutionId()) {
    validateUniqueIds(tasks);
    validateAcyclic(tasks);
    this.executionId = executionId;
    for (const task of tasks) {
      this.tasks.set(task.id, {
        task,
        state: "pending",
        attempt: 0,
      });
    }
  }

  public snapshot(): SwarmSnapshot {
    const states: Record<string, SwarmTaskSnapshot> = {};
    for (const [id, entry] of this.tasks) {
      states[id] = Object.freeze({
        id,
        agentId: entry.task.agentId,
        state: entry.state,
        attempt: entry.attempt,
        ...(entry.startedAt === undefined ? {} : { startedAt: entry.startedAt }),
        ...(entry.completedAt === undefined ? {} : { completedAt: entry.completedAt }),
        ...(entry.error === undefined ? {} : { error: entry.error }),
        ...(entry.output === undefined ? {} : { output: entry.output }),
      });
    }
    return Object.freeze({
      executionId: this.executionId,
      states: Object.freeze(states),
      outputs: Object.freeze(Object.fromEntries(this.outputs)),
      eventLog: Object.freeze([...this.events]),
    });
  }

  public abort(reason = "swarm execution aborted"): void {
    if (!this.controller.signal.aborted) this.controller.abort(new Error(reason));
  }

  public async run(options: SwarmRunOptions = {}): Promise<SwarmRunResult> {
    const maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 4));
    if (options.signal?.aborted) this.controller.abort(options.signal.reason);
    const detachAbort = options.signal
      ? () => this.controller.abort(options.signal?.reason)
      : undefined;
    options.signal?.addEventListener("abort", detachAbort!, { once: true });

    const running = new Map<string, Promise<void>>();
    try {
      while (true) {
        this.refreshReadiness();

        if (this.controller.signal.aborted) {
          this.cancelNonTerminal();
        } else if (options.failFast === true && this.hasFailure()) {
          this.controller.abort(new Error("fail-fast swarm cancellation"));
          this.cancelNonTerminal();
        }

        const ready = [...this.tasks.values()]
          .filter((entry) => entry.state === "ready")
          .sort((a, b) => a.task.id.localeCompare(b.task.id));

        while (running.size < maxConcurrency && ready.length > 0 && !this.controller.signal.aborted) {
          const entry = ready.shift()!;
          const promise = this.executeEntry(entry, options.failFast === true);
          running.set(entry.task.id, promise);
          const cleanup = (): void => {
            running.delete(entry.task.id);
          };
          void promise.then(cleanup, cleanup);
        }

        if (running.size === 0) {
          this.refreshReadiness();
          this.blockUnresolvableTasks();
          const active = [...this.tasks.values()].some((entry) => !TERMINAL_STATES.has(entry.state));
          if (!active) break;
          if (this.controller.signal.aborted) {
            this.cancelNonTerminal();
            break;
          }
        }

        if (running.size > 0) {
          await Promise.race(running.values());
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", detachAbort!);
    }

    const succeeded: string[] = [];
    const failed: string[] = [];
    const cancelled: string[] = [];
    const blocked: string[] = [];
    for (const entry of this.tasks.values()) {
      if (entry.state === "succeeded") succeeded.push(entry.task.id);
      else if (entry.state === "failed") failed.push(entry.task.id);
      else if (entry.state === "cancelled") cancelled.push(entry.task.id);
      else if (entry.state === "blocked") blocked.push(entry.task.id);
    }

    return Object.freeze({
      executionId: this.executionId,
      succeeded: Object.freeze(succeeded.sort()),
      failed: Object.freeze(failed.sort()),
      cancelled: Object.freeze(cancelled.sort()),
      blocked: Object.freeze(blocked.sort()),
      outputs: Object.freeze(Object.fromEntries(this.outputs)),
      snapshot: this.snapshot(),
    });
  }

  private async executeEntry(entry: MutableTaskState, failFast: boolean): Promise<void> {
    const maxAttempts = entry.task.maxAttempts ?? 1;
    this.transition(entry, "running");
    entry.attempt += 1;
    entry.startedAt = Date.now();

    try {
      const dependencyOutputs: Record<string, unknown> = {};
      for (const dependency of entry.task.dependsOn ?? []) {
        dependencyOutputs[dependency] = this.outputs.get(dependency);
      }

      const output = await entry.task.execute({
        taskId: entry.task.id,
        agentId: entry.task.agentId,
        attempt: entry.attempt,
        signal: this.controller.signal,
        dependencyOutputs: Object.freeze(dependencyOutputs),
      });

      if (this.controller.signal.aborted) {
        entry.completedAt = Date.now();
        this.transition(entry, "cancelled");
        return;
      }

      entry.output = output;
      this.outputs.set(entry.task.id, output);
      entry.completedAt = Date.now();
      this.transition(entry, "succeeded");
    } catch (error) {
      entry.error = errorMessage(error);
      entry.completedAt = Date.now();
      if (!this.controller.signal.aborted && entry.attempt < maxAttempts) {
        this.transition(entry, "pending");
        return;
      }
      this.transition(entry, this.controller.signal.aborted ? "cancelled" : "failed");
      if (failFast && !this.controller.signal.aborted) {
        this.controller.abort(new Error(`Task ${entry.task.id} failed: ${entry.error}`));
      }
    }
  }

  private refreshReadiness(): void {
    for (const entry of this.tasks.values()) {
      if (entry.state !== "pending") continue;
      const dependencies = entry.task.dependsOn ?? [];
      const dependencyStates = dependencies.map((id) => this.tasks.get(id)?.state);
      if (dependencyStates.some((state) => state === "failed" || state === "cancelled" || state === "blocked")) {
        this.transition(entry, "blocked");
        entry.error = "dependency did not succeed";
        entry.completedAt = Date.now();
        continue;
      }
      if (dependencyStates.every((state) => state === "succeeded")) {
        this.transition(entry, "ready");
      }
    }
  }

  private blockUnresolvableTasks(): void {
    for (const entry of this.tasks.values()) {
      if (entry.state !== "pending") continue;
      const dependencies = entry.task.dependsOn ?? [];
      if (dependencies.some((id) => !TERMINAL_STATES.has(this.tasks.get(id)?.state ?? "pending"))) continue;
      entry.error = "dependencies are not satisfiable";
      entry.completedAt = Date.now();
      this.transition(entry, "blocked");
    }
  }

  private cancelNonTerminal(): void {
    for (const entry of this.tasks.values()) {
      if (entry.state !== "pending" && entry.state !== "ready") continue;
      entry.error ??= "swarm execution cancelled";
      entry.completedAt ??= Date.now();
      this.transition(entry, "cancelled");
    }
  }

  private hasFailure(): boolean {
    return [...this.tasks.values()].some((entry) => entry.state === "failed");
  }

  private transition(entry: MutableTaskState, next: SwarmTaskState): void {
    const allowed = TRANSITIONS[entry.state];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid swarm transition ${entry.state} -> ${next} for ${entry.task.id}`);
    }
    const previous = entry.state;
    entry.state = next;
    this.events.push(Object.freeze({
      sequence: ++this.eventSequence,
      taskId: entry.task.id,
      from: previous,
      to: next,
      timestamp: Date.now(),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    }));
  }
}
