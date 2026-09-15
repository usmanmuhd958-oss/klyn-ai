import { AgentEventBus } from "./AgentEventBus.js";
import { ContextStore, type ContextSnapshot } from "./ContextStore.js";

export interface SwarmAgent {
  readonly id: string;
  readonly capabilities: readonly string[];
  readonly maxConcurrency?: number;
}

export interface SwarmTask<T = unknown> {
  readonly id: string;
  readonly requiredCapabilities: readonly string[];
  readonly input: T;
}

export type SwarmTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface SwarmTaskState {
  readonly taskId: string;
  readonly agentId: string | null;
  readonly status: SwarmTaskStatus;
  readonly attempt: number;
  readonly error?: string;
}

export interface SwarmDispatchResult<T = unknown> {
  readonly taskId: string;
  readonly agentId: string;
  readonly output: T;
  readonly state: SwarmTaskState;
  readonly context: ContextSnapshot<SwarmTaskState>;
}

export type SwarmExecutor = <T>(
  agent: SwarmAgent,
  task: SwarmTask<T>,
  signal: AbortSignal,
) => Promise<unknown>;

export class SwarmRouter {
  private readonly agents = new Map<string, SwarmAgent>();
  private readonly states = new Map<string, SwarmTaskState>();
  private readonly active = new Map<string, number>();
  private readonly eventBus: AgentEventBus;
  private readonly contextStore: ContextStore<SwarmTaskState>;
  private roundRobinCursor = 0;

  constructor(eventBus = new AgentEventBus(), contextStore = new ContextStore<SwarmTaskState>()) {
    this.eventBus = eventBus;
    this.contextStore = contextStore;
  }

  registerAgent(agent: SwarmAgent): this {
    if (this.agents.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
    this.agents.set(agent.id, Object.freeze({ ...agent, capabilities: Object.freeze([...agent.capabilities]) }));
    this.active.set(agent.id, 0);
    return this;
  }

  unregisterAgent(agentId: string): boolean {
    if ((this.active.get(agentId) ?? 0) > 0) throw new Error(`Agent ${agentId} has active tasks`);
    this.active.delete(agentId);
    return this.agents.delete(agentId);
  }

  getTaskState(taskId: string): SwarmTaskState | undefined {
    return this.states.get(taskId);
  }

  snapshot(taskId: string): ContextSnapshot<SwarmTaskState> | undefined {
    return this.contextStore.latest(taskId);
  }

  async dispatch<T>(task: SwarmTask<T>, execute: SwarmExecutor, signal = new AbortController().signal): Promise<SwarmDispatchResult> {
    if (this.states.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    const agent = this.selectAgent(task.requiredCapabilities);
    this.active.set(agent.id, (this.active.get(agent.id) ?? 0) + 1);
    const queued: SwarmTaskState = Object.freeze({ taskId: task.id, agentId: agent.id, status: "queued", attempt: 0 });
    this.states.set(task.id, queued);
    try {
      await this.eventBus.publish("agent.task.dispatched", { taskId: task.id, agentId: agent.id, attempt: 1 });

      const running: SwarmTaskState = Object.freeze({ ...queued, status: "running", attempt: 1 });
      this.states.set(task.id, running);
      await this.eventBus.publish("agent.task.started", { taskId: task.id, agentId: agent.id });
      try {
        const output = await execute(agent, task, signal);
        const succeeded: SwarmTaskState = Object.freeze({ ...running, status: "succeeded" });
        this.states.set(task.id, succeeded);
        const context = this.contextStore.snapshot(task.id, succeeded);
        await this.eventBus.publish("agent.task.completed", { taskId: task.id, agentId: agent.id, output });
        await this.eventBus.publish("agent.context.snapshot", { executionId: task.id, revision: context.revision });
        return { taskId: task.id, agentId: agent.id, output, state: succeeded, context };
      } catch (error) {
        const failed: SwarmTaskState = Object.freeze({
          ...running,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        this.states.set(task.id, failed);
        this.contextStore.snapshot(task.id, failed);
        await this.eventBus.publish("agent.task.failed", { taskId: task.id, agentId: agent.id, error: failed.error! });
        throw error;
      }
    } finally {
      this.active.set(agent.id, Math.max(0, (this.active.get(agent.id) ?? 1) - 1));
    }
  }

  async dispatchParallel<T>(tasks: readonly SwarmTask<T>[], execute: SwarmExecutor, signal = new AbortController().signal): Promise<readonly SwarmDispatchResult[]> {
    return Promise.all(tasks.map((task) => this.dispatch(task, execute, signal)));
  }

  private selectAgent(requiredCapabilities: readonly string[]): SwarmAgent {
    const candidates = [...this.agents.values()]
      .filter((agent) => requiredCapabilities.every((capability) => agent.capabilities.includes(capability)))
      .filter((agent) => (this.active.get(agent.id) ?? 0) < (agent.maxConcurrency ?? Number.MAX_SAFE_INTEGER))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (candidates.length === 0) throw new Error(`No available agent satisfies capabilities: ${requiredCapabilities.join(", ")}`);
    const selected = candidates[this.roundRobinCursor % candidates.length]!;
    this.roundRobinCursor = (this.roundRobinCursor + 1) % candidates.length;
    return selected;
  }
}
