function normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(magnitude) || magnitude === 0) {
        throw new Error("Embedding vector must have non-zero finite magnitude");
    }
    return vector.map((value) => value / magnitude);
}
export function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0) {
        throw new Error("Embedding dimensions must match and be non-zero");
    }
    const left = normalize(a);
    const right = normalize(b);
    return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}
/** Deterministic local encoder for tests and deployments without a model provider. */
export class DeterministicEmbeddingProvider {
    dimension;
    constructor(dimension = 64) {
        this.dimension = dimension;
        if (!Number.isInteger(dimension) || dimension < 2)
            throw new Error("Embedding dimension must be >= 2");
    }
    async embed(text) {
        const vector = new Array(this.dimension).fill(0);
        const normalized = text.normalize("NFKC").toLowerCase();
        for (let index = 0; index < normalized.length; index += 1) {
            const code = normalized.charCodeAt(index);
            const position = (code + index) % this.dimension;
            vector[position] = (vector[position] ?? 0) + 1 + (code % 7) / 7;
        }
        if (vector[0] === 0)
            vector[0] = 1;
        return normalize(vector);
    }
}
export class ContextEmbeddingEngine {
    provider;
    constructor(provider) {
        this.provider = provider;
    }
    async encode(text) {
        if (!text.trim())
            throw new Error("Cannot embed empty context");
        const vector = Array.from(await this.provider.embed(text));
        return normalize(vector);
    }
}
/** Exact flat k-NN index. It is deterministic and can later be backed by HNSW without changing the API. */
export class VectorMemoryIndex {
    dimension;
    maxRecords;
    records = new Map();
    constructor(dimension, maxRecords = 10000) {
        this.dimension = dimension;
        this.maxRecords = maxRecords;
        if (!Number.isInteger(dimension) || dimension < 2)
            throw new Error("Invalid vector dimension");
        if (!Number.isInteger(maxRecords) || maxRecords < 1)
            throw new Error("Invalid maxRecords");
    }
    upsert(record) {
        if (record.vector.length !== this.dimension)
            throw new Error("Vector dimension mismatch");
        const vector = normalize(record.vector);
        const existing = this.records.has(record.id);
        if (!existing && this.records.size >= this.maxRecords)
            this.gc();
        if (!existing && this.records.size >= this.maxRecords)
            throw new Error("Vector memory capacity exhausted");
        this.records.set(record.id, { ...record, vector });
    }
    search(namespace, query, k = 5, now = Date.now()) {
        if (query.length !== this.dimension)
            throw new Error("Query vector dimension mismatch");
        if (!Number.isInteger(k) || k < 1)
            throw new Error("Invalid k");
        const candidates = [];
        for (const record of this.records.values()) {
            if (record.namespace !== namespace)
                continue;
            if (record.expiresAt !== undefined && record.expiresAt <= now)
                continue;
            candidates.push({ id: record.id, namespace, score: cosineSimilarity(record.vector, query), payload: record.payload });
        }
        return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
    }
    delete(id) { return this.records.delete(id); }
    gc(now = Date.now()) {
        let removed = 0;
        for (const [id, record] of this.records) {
            if (record.expiresAt !== undefined && record.expiresAt <= now) {
                this.records.delete(id);
                removed += 1;
            }
        }
        return removed;
    }
    size() { return this.records.size; }
}
export class CrossAgentKnowledgeBus {
    embeddings;
    index;
    constructor(embeddings, index) {
        this.embeddings = embeddings;
        this.index = index;
    }
    async publish(item, now = Date.now()) {
        const vector = await this.embeddings.encode(item.content);
        this.index.upsert({ id: item.id, namespace: item.namespace, vector, payload: item.payload, createdAt: now, expiresAt: item.ttlMs === undefined ? undefined : now + item.ttlMs });
    }
    async query(namespace, text, k = 5, now = Date.now()) {
        const vector = await this.embeddings.encode(text);
        this.index.gc(now);
        return this.index.search(namespace, vector, k, now);
    }
}
//# sourceMappingURL=vector-memory.js.map