export declare class HashEngine {
    private static readonly HASH_ALGO;
    static hash(data: Uint8Array | string): string;
    static hashCombine(hashes: string[]): string;
    static contentHash(content: string, links: string[]): string;
}
//# sourceMappingURL=hash.d.ts.map