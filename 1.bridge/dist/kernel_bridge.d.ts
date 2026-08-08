export interface KernelEventPayload {
    eventType: number;
    data: Uint8Array;
}
export interface NativeKernel {
    submitEvent(buffer: Buffer): number;
    processBatch(maxEvents: number): number;
    loadLawBytecode(bytecode: Buffer): void;
    sealData(data: Buffer): Buffer;
    unsealData(sealedBuffer: Buffer): Buffer;
    getProcessedCount(): number;
    getPendingCount(): number;
    shutdown(): void;
}
export declare class KernelBridge {
    private nativeKernel;
    private isInitialized;
    constructor();
    submitEvent(payload: KernelEventPayload): number;
    processBatch(maxEvents?: number): number;
    sealData(data: Uint8Array): Uint8Array;
    unsealData(sealedData: Uint8Array): Uint8Array;
    getStats(): {
        processed: number;
        pending: number;
    };
    shutdown(): void;
    private assertActive;
}
export interface KernelAccel {
    readonly available: boolean;
    readonly backend: 'native' | 'js';
    /** query x matrix(rows*dims) -> per-row dot scores (SIMD on native). */
    dotBatch(query: Float32Array, matrix: Float32Array, dims: number): Float32Array;
    /** Write one row into the shared mmap matrix; returns current row count. */
    matrixUpsert(row: number, vector: Float32Array): number;
    /** Push a value into the lock-free ring buffer. */
    ringPush(value: number): boolean;
    /** Pop the oldest value from the ring buffer (null when empty). */
    ringPop(): number | null;
    ringLen(): number;
}
/** Canonical acceleration surface used by the brain layers. */
export declare const kernelAccel: KernelAccel;
export default KernelBridge;
