import type { NodeMetadata } from '../types/core.js';
export interface ScanOptions {
    ignore?: string[];
    maxDepth?: number;
    maxFileSize?: number;
}
export declare class FileScanner {
    private static readonly DEFAULT_IGNORE;
    static scan(rootPath: string, options?: ScanOptions): AsyncGenerator<{
        path: string;
        content: Uint8Array;
        metadata: NodeMetadata;
    }>;
}
//# sourceMappingURL=file_scanner.d.ts.map