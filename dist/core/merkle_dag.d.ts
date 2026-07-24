import type { MerkleNode, NodeMetadata } from '../types/core.js';
export declare class MerkleDAGEngine {
    private nodes;
    private pathToHash;
    add(data: Uint8Array, metadata: NodeMetadata, links?: string[]): string;
    get(hash: string): MerkleNode | undefined;
    getByPath(path: string): MerkleNode | undefined;
    has(hash: string): boolean;
    update(oldHash: string, data: Uint8Array, links: string[]): string;
    getLinks(hash: string): string[];
    size(): number;
    clear(): void;
    getAllHashes(): string[];
    traverse(rootHash: string): Generator<MerkleNode>;
}
//# sourceMappingURL=merkle_dag.d.ts.map