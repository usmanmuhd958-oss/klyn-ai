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
