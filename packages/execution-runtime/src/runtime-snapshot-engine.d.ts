export interface RuntimeSnapshot {
    readonly id: string;
    readonly workspace: string;
    readonly snapshotPath: string;
}
export declare class RuntimeSnapshotEngine {
    create(workspace: string): Promise<RuntimeSnapshot>;
    rollback(snapshot: RuntimeSnapshot): Promise<void>;
    discard(snapshot: RuntimeSnapshot): Promise<void>;
}
//# sourceMappingURL=runtime-snapshot-engine.d.ts.map