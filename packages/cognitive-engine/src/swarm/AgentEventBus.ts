export type SwarmEventTopic =
  | "agent.task.dispatched"
  | "agent.task.started"
  | "agent.task.completed"
  | "agent.task.failed"
  | "agent.telemetry"
  | "agent.context.snapshot";

export interface SwarmEventPayloads {
  "agent.task.dispatched": { readonly taskId: string; readonly agentId: string; readonly attempt: number };
  "agent.task.started": { readonly taskId: string; readonly agentId: string };
  "agent.task.completed": { readonly taskId: string; readonly agentId: string; readonly output: unknown };
  "agent.task.failed": { readonly taskId: string; readonly agentId: string; readonly error: string };
  "agent.telemetry": { readonly agentId: string; readonly metric: string; readonly value: number; readonly unit?: string };
  "agent.context.snapshot": { readonly executionId: string; readonly revision: number };
}

export interface SwarmEventEnvelope<T extends SwarmEventTopic = SwarmEventTopic> {
  readonly id: string;
  readonly topic: T;
  readonly timestamp: number;
  readonly sequence: number;
  readonly payload: SwarmEventPayloads[T];
}

export type SwarmTopicFilter<T extends SwarmEventTopic = SwarmEventTopic> =
  | T
  | `${T}.*`
  | ((topic: SwarmEventTopic) => boolean);

export type SwarmEventHandler<T extends SwarmEventTopic> = (
  event: SwarmEventEnvelope<T>,
) => void | Promise<void>;

interface Subscription<T extends SwarmEventTopic> {
  readonly matches: (topic: SwarmEventTopic) => boolean;
  readonly handler: SwarmEventHandler<T>;
}

export class AgentEventBus {
  private readonly subscriptions = new Set<Subscription<SwarmEventTopic>>();
  private readonly history: SwarmEventEnvelope[] = [];
  private sequence = 0;
  private closed = false;

  subscribe<T extends SwarmEventTopic>(
    filter: SwarmTopicFilter<T>,
    handler: SwarmEventHandler<T>,
  ): () => void {
    if (this.closed) throw new Error("AgentEventBus is closed");
    const matches = this.createMatcher(filter);
    const subscription: Subscription<SwarmEventTopic> = {
      matches,
      handler: handler as SwarmEventHandler<SwarmEventTopic>,
    };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  async publish<T extends SwarmEventTopic>(
    topic: T,
    payload: SwarmEventPayloads[T],
  ): Promise<SwarmEventEnvelope<T>> {
    if (this.closed) throw new Error("AgentEventBus is closed");
    const event: SwarmEventEnvelope<T> = Object.freeze({
      id: `evt_${this.sequence + 1}`,
      topic,
      timestamp: Date.now(),
      sequence: ++this.sequence,
      payload,
    });
    this.history.push(event as SwarmEventEnvelope);
    const deliveries = [...this.subscriptions]
      .filter((subscription) => subscription.matches(topic))
      .map((subscription) => subscription.handler(event as never));
    await Promise.all(deliveries);
    return event;
  }

  snapshot(): readonly SwarmEventEnvelope[] {
    return Object.freeze([...this.history]);
  }

  close(): void {
    this.subscriptions.clear();
    this.closed = true;
  }

  private createMatcher<T extends SwarmEventTopic>(filter: SwarmTopicFilter<T>): (topic: SwarmEventTopic) => boolean {
    if (typeof filter === "function") return filter;
    if (filter.endsWith(".*")) {
      const prefix = filter.slice(0, -2);
      return (topic) => topic === prefix || topic.startsWith(`${prefix}.`);
    }
    return (topic) => topic === filter;
  }
}
