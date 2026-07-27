import { KernelBridge } from '../../1.bridge/dist/kernel_bridge';
export interface VFSNode {
    path: string;
    isDir: boolean;
    size: number;
    updatedAt: number;
    content?: Uint8Array;
}
export declare class VirtualFileSystem {
    private memoryStore;
    private bridge;
    constructor(bridge: KernelBridge);
    writeFile(path: string, content: Uint8Array, encrypt?: boolean): void;
    readFile(path: string, isEncrypted?: boolean): Uint8Array;
    exists(path: string): boolean;
    listFiles(): string[];
    private normalize;
}
