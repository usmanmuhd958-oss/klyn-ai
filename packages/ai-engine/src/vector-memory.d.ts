export interface EmbeddingProvider {
    embed(text: string): Promise<readonly number[]>;
}
export interface EmbeddingRecord<T = unknown> {
    id: string;
    namespace: string;
    vector: readonly number[];
    payload: T;
    createdAt: number;
    expiresAt?: number;
}
export interface VectorSearchResult<T = unknown> {
    id: string;
    namespace: string;
    score: number;
    payload: T;
}
export declare function cosineSimilarity(a: readonly number[], b: readonly number[]): number;
/** Deterministic local encoder for tests and deployments without a model provider. */
export declare class DeterministicEmbeddingProvider implements EmbeddingProvider {
    private readonly dimension;
    constructor(dimension?: number);
    embed(text: string): Promise<readonly number[]>;
}
export declare class ContextEmbeddingEngine {
    private readonly provider;
    constructor(provider: EmbeddingProvider);
    encode(text: string): Promise<number[]>;
}
/** Exact flat k-NN index. It is deterministic and can later be backed by HNSW without changing the API. */
export declare class VectorMemoryIndex<T = unknown> {
    private readonly dimension;
    private readonly maxRecords;
    private readonly records;
    constructor(dimension: number, maxRecords?: number);
    upsert(record: EmbeddingRecord<T>): void;
    search(namespace: string, query: readonly number[], k?: number, now?: number): VectorSearchResult<T>[];
    delete(id: string): boolean;
    gc(now?: number): number;
    size(): number;
}
export interface KnowledgeItem<T = unknown> {
    id: string;
    namespace: string;
    content: string;
    payload: T;
    ttlMs?: number;
}
export declare class CrossAgentKnowledgeBus<T = unknown> {
    private readonly embeddings;
    private readonly index;
    constructor(embeddings: ContextEmbeddingEngine, index: VectorMemoryIndex<T>);
    publish(item: KnowledgeItem<T>, now?: number): Promise<void>;
    query(namespace: string, text: string, k?: number, now?: number): Promise<VectorSearchResult<T>[]>;
}
//# sourceMappingURL=vector-memory.d.ts.map