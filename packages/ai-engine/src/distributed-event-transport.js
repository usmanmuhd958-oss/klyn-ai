/** Bridges the local AgentEventBus contract to a durable cross-node transport.
 * Delivery is at-least-once: consumers must make handlers idempotent and may receive duplicates.
 */
export class DistributedEventBridge {
    bus;
    options;
    seen = new Set();
    sequence = 0;
    subscriptions = new Set();
    closed = false;
    constructor(bus, options) {
        this.bus = bus;
        this.options = options;
    }
    async publish(topic, payload) {
        this.assertOpen();
        const event = Object.freeze({
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
    bridgeTopic(topic) {
        this.assertOpen();
        const unsubscribe = this.options.transport.subscribe(topic, this.options.consumerId ?? `${this.options.nodeId}:${topic}`, async (delivery) => {
            if (this.seen.has(delivery.event.id)) {
                this.options.onDuplicate?.(delivery.event.id);
                return;
            }
            this.seen.add(delivery.event.id);
            await this.bus.publish(delivery.event.topic, delivery.event.payload);
        });
        this.subscriptions.add(unsubscribe);
        return () => {
            if (this.subscriptions.delete(unsubscribe))
                unsubscribe();
        };
    }
    bridgeLocalPublish(topic) {
        this.assertOpen();
        return this.bus.subscribe(topic, async (event) => {
            await this.publish(topic, event);
        });
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const unsubscribe of this.subscriptions)
            unsubscribe();
        this.subscriptions.clear();
        this.seen.clear();
    }
    assertOpen() {
        if (this.closed)
            throw new Error("DistributedEventBridge is closed");
    }
}
/** Deterministic durable test adapter. Production deployments can implement the same contract with Redis Streams, NATS JetStream, or another durable queue. */
export class InMemoryDurableEventTransport {
    events = [];
    consumers = new Map();
    async publish(event) {
        this.events.push(event);
        const matching = [...this.consumers.entries()].filter(([, consumer]) => consumer.topic === event.topic);
        await Promise.all(matching.map(async ([consumerId, consumer]) => {
            await consumer.handler({ deliveryId: `${event.id}:${consumerId}`, event, attempt: 1 });
        }));
    }
    subscribe(topic, consumerId, handler) {
        if (this.consumers.has(consumerId))
            throw new Error(`Consumer already registered: ${consumerId}`);
        const wrapped = handler;
        this.consumers.set(consumerId, { topic, handler: wrapped });
        return () => this.consumers.delete(consumerId);
    }
    history() {
        return Object.freeze([...this.events]);
    }
}
//# sourceMappingURL=distributed-event-transport.js.map