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
export declare class DistributedEventBridge {
    private readonly bus;
    private readonly options;
    private readonly seen;
    private sequence;
    private readonly subscriptions;
    private closed;
    constructor(bus: EventBusLike, options: DistributedEventBridgeOptions);
    publish(topic: string, payload: unknown): Promise<DistributedEvent>;
    bridgeTopic(topic: string): () => void;
    bridgeLocalPublish(topic: string): () => void;
    close(): void;
    private assertOpen;
}
/** Deterministic durable test adapter. Production deployments can implement the same contract with Redis Streams, NATS JetStream, or another durable queue. */
export declare class InMemoryDurableEventTransport implements DurableEventTransport {
    private readonly events;
    private readonly consumers;
    publish<T>(event: DistributedEvent<T>): Promise<void>;
    subscribe<T>(topic: string, consumerId: string, handler: (delivery: EventDelivery<T>) => Promise<void>): () => void;
    history(): readonly DistributedEvent[];
}
//# sourceMappingURL=distributed-event-transport.d.ts.map