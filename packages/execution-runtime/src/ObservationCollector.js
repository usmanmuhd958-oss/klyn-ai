import { createHash } from "node:crypto";
export const SYSTEM_CLOCK = Object.freeze({
    now: () => Date.now(),
});
function canonicalize(value) {
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map(canonicalize);
    const object = value;
    return Object.keys(object).sort().reduce((result, key) => {
        result[key] = canonicalize(object[key]);
        return result;
    }, {});
}
function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
export class ObservationCollector {
    clock;
    events = [];
    metadata;
    sequence = 0;
    previousHash = "0".repeat(64);
    constructor(clock = SYSTEM_CLOCK) {
        this.clock = clock;
    }
    createChild() {
        return new ObservationCollector(this.clock);
    }
    begin(metadata) {
        if (this.metadata !== undefined)
            throw new Error("Observation session has already started");
        if (!metadata.executionId || !metadata.taskId || !metadata.agentId)
            throw new Error("Observation metadata is incomplete");
        this.metadata = Object.freeze({ ...metadata });
    }
    record(type, payload) {
        if (this.metadata === undefined)
            throw new Error("Observation session has not started");
        const input = {
            executionId: this.metadata.executionId,
            sequence: this.sequence,
            timestampMs: this.clock.now(),
            type,
            payload: canonicalize(payload),
            previousHash: this.previousHash,
        };
        const event = Object.freeze({
            ...input,
            hash: digest(input),
        });
        this.events.push(event);
        this.sequence += 1;
        this.previousHash = event.hash;
        return event;
    }
    recordFilesystemMutations(before, after) {
        const paths = new Set([...before.keys(), ...after.keys()]);
        const sortedPaths = [...paths].sort();
        for (const path of sortedPaths) {
            const oldDigest = before.get(path);
            const newDigest = after.get(path);
            if (oldDigest === undefined && newDigest !== undefined) {
                this.record("filesystem.created", { path, digest: newDigest });
            }
            else if (oldDigest !== undefined && newDigest === undefined) {
                this.record("filesystem.deleted", { path, previousDigest: oldDigest });
            }
            else if (oldDigest !== newDigest) {
                this.record("filesystem.modified", { path, previousDigest: oldDigest ?? null, digest: newDigest ?? null });
            }
        }
    }
    finalize() {
        if (this.metadata === undefined)
            throw new Error("Observation session has not started");
        return Object.freeze({
            events: Object.freeze([...this.events]),
            streamHash: this.previousHash,
        });
    }
}
//# sourceMappingURL=ObservationCollector.js.map