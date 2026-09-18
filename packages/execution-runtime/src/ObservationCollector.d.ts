export type ObservationEventType = "process.started" | "stdout" | "stderr" | "filesystem.created" | "filesystem.modified" | "filesystem.deleted" | "resource.snapshot" | "process.exited" | "sandbox.rollback";
export interface ObservationClock {
    now(): number;
}
export interface ObservationEventInput {
    readonly type: ObservationEventType;
    readonly payload: Readonly<Record<string, unknown>>;
}
export interface ObservationEvent extends ObservationEventInput {
    readonly executionId: string;
    readonly sequence: number;
    readonly timestampMs: number;
    readonly previousHash: string;
    readonly hash: string;
}
export interface ObservationSessionMetadata {
    readonly executionId: string;
    readonly taskId: string;
    readonly agentId: string;
}
export interface ObservationSnapshot {
    readonly events: readonly ObservationEvent[];
    readonly streamHash: string;
}
export declare const SYSTEM_CLOCK: ObservationClock;
export declare class ObservationCollector {
    private readonly clock;
    private readonly events;
    private metadata;
    private sequence;
    private previousHash;
    constructor(clock?: ObservationClock);
    createChild(): ObservationCollector;
    begin(metadata: ObservationSessionMetadata): void;
    record(type: ObservationEventType, payload: Readonly<Record<string, unknown>>): ObservationEvent;
    recordFilesystemMutations(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): void;
    finalize(): ObservationSnapshot;
}
//# sourceMappingURL=ObservationCollector.d.ts.map