export interface DistributedEvent<T = unknown> {
  readonly id: string;
  readonly topic: string;
  readonly nodeId: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly payload: T;
}

export interface EventDelivery<T = unknown> {
  readonly deliveryId: string;
  readonly event: DistributedEvent<T>;
  readonly attempt: number;
}

export interface DurableEventTransport {
  publish<T>(event: DistributedEvent<T>): Promise<void>;
  subscribe<T>(topic: string, consumerId: string, handler: (delivery: EventDelivery<T>) => Promise<void>): () => void;
}

export interface EventBusLike {
  subscribe<T>(filter: string, handler: (event: T) => void | Promise<void>): () => void;
  publish(topic: string, payload: unknown): Promise<unknown>;
}

export interface DistributedEventBridgeOptions {
  readonly nodeId: string;
  readonly transport: DurableEventTransport;
  readonly consumerId?: string;
  readonly onDuplicate?: (eventId: string) => void;
}

/** Bridges the local AgentEventBus contract to a durable cross-node transport.
 * Delivery is at-least-once: consumers must make handlers idempotent and may receive duplicates.
 */
export class DistributedEventBridge {
  private readonly seen = new Set<string>();
  private sequence = 0;
  private readonly subscriptions = new Set<() => void>();
  private closed = false;

  constructor(private readonly bus: EventBusLike, private readonly options: DistributedEventBridgeOptions) {}

  async publish(topic: string, payload: unknown): Promise<DistributedEvent> {
    this.assertOpen();
    const event: DistributedEvent = Object.freeze({
      id: `${this.options.nodeId}:${++this.sequence}`,
      topic,
      nodeId: this.options.nodeId,
      sequence: this.sequence,
      timestamp: Date.now(),
      payload,
    });
    this.seen.add(event.id);
    await this.options.transport.publish(event);
    return event;
  }

  bridgeTopic(topic: string): () => void {
    this.assertOpen();
    const unsubscribe = this.options.transport.subscribe<unknown>(
      topic,
      this.options.consumerId ?? `${this.options.nodeId}:${topic}`,
      async (delivery) => {
        if (this.seen.has(delivery.event.id)) {
          this.options.onDuplicate?.(delivery.event.id);
          return;
        }
        this.seen.add(delivery.event.id);
        await this.bus.publish(delivery.event.topic, delivery.event.payload);
      },
    );
    this.subscriptions.add(unsubscribe);
    return () => {
      if (this.subscriptions.delete(unsubscribe)) unsubscribe();
    };
  }

  bridgeLocalPublish(topic: string): () => void {
    this.assertOpen();
    return this.bus.subscribe(topic, async (event) => {
      await this.publish(topic, event);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.clear();
    this.seen.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("DistributedEventBridge is closed");
  }
}

/** Deterministic durable test adapter. Production deployments can implement the same contract with Redis Streams, NATS JetStream, or another durable queue. */
export class InMemoryDurableEventTransport implements DurableEventTransport {
  private readonly events: DistributedEvent[] = [];
  private readonly consumers = new Map<string, { topic: string; handler: (delivery: EventDelivery) => Promise<void> }>();

  async publish<T>(event: DistributedEvent<T>): Promise<void> {
    this.events.push(event);
    const matching = [...this.consumers.entries()].filter(([, consumer]) => consumer.topic === event.topic);
    await Promise.all(matching.map(async ([consumerId, consumer]) => {
      await consumer.handler({ deliveryId: `${event.id}:${consumerId}`, event, attempt: 1 });
    }));
  }

  subscribe<T>(topic: string, consumerId: string, handler: (delivery: EventDelivery<T>) => Promise<void>): () => void {
    if (this.consumers.has(consumerId)) throw new Error(`Consumer already registered: ${consumerId}`);
    const wrapped = handler as (delivery: EventDelivery) => Promise<void>;
    this.consumers.set(consumerId, { topic, handler: wrapped });
    return () => this.consumers.delete(consumerId);
  }

  history(): readonly DistributedEvent[] {
    return Object.freeze([...this.events]);
  }
}
