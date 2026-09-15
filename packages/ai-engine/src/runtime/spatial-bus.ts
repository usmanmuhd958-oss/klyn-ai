import type {
  ExecutableTask,
  PlannerTaskStatus,
} from "../types/planner-bridge.types.js";
import {
  SpatialBusError,
  type SpatialBusEvent,
  type SpatialBusEventType,
  type SpatialCanvasNodeState,
  type SpatialExecutionBusOptions,
  type SpatialExecutionInput,
  type SpatialRuntimeListener,
  type SpatialRuntimeStream,
  type SpatialTaskExecutor,
} from "../types/spatial-bus.types.js";

const DEFAULT_NAMESPACE = "default";
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;

type MutableNodeState = {
  readonly taskId: string;
  readonly status: SpatialCanvasNodeState["status"];
  readonly phase: number;
  readonly prerequisites: readonly string[];
  readonly completedPrerequisites: readonly string[];
  readonly executionId: string;
  readonly namespace: string;
  readonly sequence: number;
  readonly error?: string;
};

type ExecutionRecord = {
  readonly executionId: string;
  readonly namespace: string;
  nodes: ReadonlyMap<string, MutableNodeState>;
  readonly stream: StreamController;
};

class StreamController implements SpatialRuntimeStream {
  public readonly executionId: string;
  public readonly namespace: string;

  #maxBufferedEvents: number;
  #bufferedEvents: SpatialBusEvent[] = [];
  #listeners = new Set<SpatialRuntimeListener>();
  #closed = false;

  public constructor(executionId: string, namespace: string, maxBufferedEvents: number) {
    this.executionId = executionId;
    this.namespace = namespace;
    this.#maxBufferedEvents = maxBufferedEvents;
  }

  public get events(): readonly SpatialBusEvent[] {
    return Object.freeze([...this.#bufferedEvents]);
  }

  public subscribe(listener: SpatialRuntimeListener): () => void {
    if (this.#closed) {
      return () => undefined;
    }

    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public clear(): void {
    this.#bufferedEvents = [];
  }

  public close(): void {
    this.#closed = true;
    this.#listeners.clear();
    this.clear();
  }

  public emit(event: SpatialBusEvent): void {
    if (this.#closed) {
      return;
    }

    this.#bufferedEvents = [...this.#bufferedEvents, Object.freeze(event)].slice(-this.#maxBufferedEvents);
    const listeners = [...this.#listeners];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Observer failures cannot change committed execution state.
      }
    }
  }
}

export class SpatialBus {
  #namespace: string;
  #maxBufferedEvents: number;
  #executions = new Map<string, ExecutionRecord>();
  #sequence = 0;

  public constructor(options: SpatialExecutionBusOptions = {}) {
    this.#namespace = options.namespace?.trim() || DEFAULT_NAMESPACE;
    this.#maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;

    if (!Number.isInteger(this.#maxBufferedEvents) || this.#maxBufferedEvents < 1) {
      throw new SpatialBusError(
        "SPATIAL_BUS_BUFFER_LIMIT",
        "maxBufferedEvents must be a positive integer",
      );
    }
  }

  public register(plan: SpatialExecutionInput): SpatialRuntimeStream {
    this.validatePlan(plan);
    const key = this.executionKey(plan.executionId);
    if (this.#executions.has(key)) {
      throw new SpatialBusError(
        "SPATIAL_BUS_DUPLICATE_EXECUTION",
        `Execution '${plan.executionId}' already exists in namespace '${this.#namespace}'`,
      );
    }

    let nodeMap = new Map<string, MutableNodeState>();
    for (const batch of plan.batches) {
      for (const task of batch.tasks) {
        if (nodeMap.has(task.node.id)) {
          throw new SpatialBusError(
            "SPATIAL_BUS_INVALID_INPUT",
            `Task '${task.node.id}' appears more than once in execution batches`,
          );
        }
        nodeMap = new Map(nodeMap).set(task.node.id, Object.freeze({
          taskId: task.node.id,
          status: "pending",
          phase: batch.phase,
          prerequisites: Object.freeze([...task.prerequisites]),
          completedPrerequisites: Object.freeze([]),
          executionId: plan.executionId,
          namespace: this.#namespace,
          sequence: 0,
        }));
      }
    }

    const stream = new StreamController(
      plan.executionId,
      this.#namespace,
      this.#maxBufferedEvents,
    );
    const record: ExecutionRecord = {
      executionId: plan.executionId,
      namespace: this.#namespace,
      nodes: nodeMap,
      stream,
    };
    this.#executions = new Map(this.#executions).set(key, record);
    this.emit(record, "execution:started");
    return stream;
  }

  public async run(
    plan: SpatialExecutionInput,
    executor: SpatialTaskExecutor,
  ): Promise<SpatialRuntimeStream> {
    const stream = this.register(plan);
    const record = this.getExecution(plan.executionId);

    for (const batch of plan.batches) {
      const tasks = [...batch.tasks].sort((left, right) => left.node.id.localeCompare(right.node.id));
      for (const task of tasks) {
        this.transition(record, task.node.id, "queued");
      }
      for (const task of tasks) {
        this.assertPrerequisitesComplete(record, task);
        this.transition(record, task.node.id, "executing");
        try {
          await executor(task);
          this.transition(record, task.node.id, "completed");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Task execution failed";
          this.transition(record, task.node.id, "failed", message);
          this.emit(record, "execution:failed", undefined, message);
          return stream;
        }
      }
    }
    this.emit(record, "execution:completed");
    return stream;
  }

  public transitionNode(
    executionId: string,
    taskId: string,
    status: Exclude<SpatialCanvasNodeState["status"], "pending">,
    error?: string,
  ): SpatialCanvasNodeState {
    const record = this.getExecution(executionId);
    const state = record.nodes.get(taskId);
    if (!state) {
      throw new SpatialBusError(
        "SPATIAL_BUS_MISSING_NODE",
        `Task '${taskId}' does not exist in execution '${executionId}'`,
      );
    }
    this.assertTransition(state.status, status);
    if (status === "executing") {
      this.assertPrerequisitesComplete(record, this.taskForState(state));
    }
    this.transition(record, taskId, status, error);
    return this.snapshot(record.nodes.get(taskId));
  }

  public getNodeState(executionId: string, taskId: string): SpatialCanvasNodeState | undefined {
    const record = this.#executions.get(this.executionKey(executionId));
    const state = record?.nodes.get(taskId);
    return state ? this.snapshot(state) : undefined;
  }

  public getExecutionStates(executionId: string): readonly SpatialCanvasNodeState[] {
    const record = this.getExecution(executionId);
    return Object.freeze(
      [...record.nodes.values()]
        .sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId))
        .map((state) => this.snapshot(state)),
    );
  }

  public close(executionId: string): void {
    const key = this.executionKey(executionId);
    const record = this.#executions.get(key);
    if (!record) {
      return;
    }
    this.emit(record, "execution:closed");
    record.stream.close();
    this.#executions = new Map(this.#executions);
    this.#executions.delete(key);
  }

  public clear(): void {
    for (const record of this.#executions.values()) {
      this.emit(record, "execution:closed");
      record.stream.close();
    }
    this.#executions = new Map();
  }

  public get activeExecutionCount(): number {
    return this.#executions.size;
  }

  private validatePlan(plan: SpatialExecutionInput): void {
    if (!plan || typeof plan.executionId !== "string" || !plan.executionId.trim()) {
      throw new SpatialBusError("SPATIAL_BUS_INVALID_INPUT", "A non-empty executionId is required");
    }
    if (!Array.isArray(plan.batches) || plan.batches.length === 0) {
      throw new SpatialBusError("SPATIAL_BUS_INVALID_INPUT", "At least one execution batch is required");
    }
  }

  private assertPrerequisitesComplete(record: ExecutionRecord, task: ExecutableTask): void {
    for (const prerequisite of task.prerequisites) {
      const state = record.nodes.get(prerequisite);
      if (!state) {
        throw new SpatialBusError(
          "SPATIAL_BUS_MISSING_NODE",
          `Prerequisite '${prerequisite}' for task '${task.node.id}' is missing`,
        );
      }
      if (state.status !== "completed") {
        throw new SpatialBusError(
          "SPATIAL_BUS_PREREQUISITE_INCOMPLETE",
          `Prerequisite '${prerequisite}' for task '${task.node.id}' is not completed`,
        );
      }
    }
  }

  private transition(
    record: ExecutionRecord,
    taskId: string,
    status: SpatialCanvasNodeState["status"],
    error?: string,
  ): void {
    const current = record.nodes.get(taskId);
    if (!current) {
      throw new SpatialBusError("SPATIAL_BUS_MISSING_NODE", `Task '${taskId}' does not exist`);
    }
    this.assertTransition(current.status, status);

    const next: MutableNodeState = Object.freeze({
      ...current,
      status,
      sequence: this.nextSequence(),
      ...(error === undefined ? {} : { error }),
      ...(status === "completed"
        ? { completedPrerequisites: Object.freeze([...current.prerequisites]) }
        : {}),
    });

    record.nodes = new Map(record.nodes).set(taskId, next);

    const eventType = this.eventTypeFor(status);
    this.emit(record, eventType, next);
  }

  private assertTransition(
    current: SpatialCanvasNodeState["status"],
    next: SpatialCanvasNodeState["status"],
  ): void {
    const allowed: Readonly<Record<SpatialCanvasNodeState["status"], readonly SpatialCanvasNodeState["status"][]>> = {
      pending: ["queued"],
      queued: ["executing", "failed"],
      executing: ["completed", "failed"],
      completed: [],
      failed: [],
    };
    if (!allowed[current].includes(next)) {
      throw new SpatialBusError(
        "SPATIAL_BUS_INVALID_TRANSITION",
        `Invalid spatial state transition '${current}' -> '${next}'`,
      );
    }
  }

  private taskForState(state: MutableNodeState): ExecutableTask {
    return {
      node: {
        id: state.taskId,
        title: state.taskId,
        description: "",
        agentType: "runtime",
        dependencies: [...state.prerequisites],
        constraints: [],
      },
      prerequisites: [...state.prerequisites],
      dependents: [],
    };
  }

  private eventTypeFor(status: PlannerTaskStatus): SpatialBusEventType {
    switch (status) {
      case "queued":
        return "node:queued";
      case "executing":
        return "node:executing";
      case "completed":
        return "node:completed";
      case "failed":
        return "node:failed";
      default:
        throw new SpatialBusError("SPATIAL_BUS_INVALID_TRANSITION", `Unsupported event state '${status}'`);
    }
  }

  private emit(
    record: ExecutionRecord,
    type: SpatialBusEventType,
    state?: MutableNodeState,
    error?: string,
  ): void {
    const sequence = this.nextSequence();
    const event: SpatialBusEvent = Object.freeze({
      id: `${record.namespace}:${record.executionId}:${sequence}`,
      sequence,
      type,
      executionId: record.executionId,
      namespace: record.namespace,
      ...(state ? { taskId: state.taskId, phase: state.phase, state: this.snapshot(state) } : {}),
      ...(error ? { error } : {}),
    });
    record.stream.emit(event);
  }

  private snapshot(state: MutableNodeState | undefined): SpatialCanvasNodeState {
    if (!state) {
      throw new SpatialBusError("SPATIAL_BUS_MISSING_NODE", "Task state disappeared during atomic transition");
    }
    return Object.freeze({
      ...state,
      prerequisites: Object.freeze([...state.prerequisites]),
      completedPrerequisites: Object.freeze([...state.completedPrerequisites]),
    });
  }

  private getExecution(executionId: string): ExecutionRecord {
    const record = this.#executions.get(this.executionKey(executionId));
    if (!record) {
      throw new SpatialBusError(
        "SPATIAL_BUS_EXECUTION_CLOSED",
        `Execution '${executionId}' is not active in namespace '${this.#namespace}'`,
      );
    }
    return record;
  }

  private executionKey(executionId: string): string {
    return `${this.#namespace}\u0000${executionId}`;
  }

  private nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }
}
