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

function normalize(vector: readonly number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Embedding vector must have non-zero finite magnitude");
  }
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error("Embedding dimensions must match and be non-zero");
  }
  const left = normalize(a);
  const right = normalize(b);
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

/** Deterministic local encoder for tests and deployments without a model provider. */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimension = 64) {
    if (!Number.isInteger(dimension) || dimension < 2) throw new Error("Embedding dimension must be >= 2");
  }

  async embed(text: string): Promise<readonly number[]> {
    const vector = new Array<number>(this.dimension).fill(0);
    const normalized = text.normalize("NFKC").toLowerCase();
    for (let index = 0; index < normalized.length; index += 1) {
      const code = normalized.charCodeAt(index);
      vector[(code + index) % this.dimension] += 1 + (code % 7) / 7;
    }
    if (vector.every((value) => value === 0)) vector[0] = 1;
    return normalize(vector);
  }
}

export class ContextEmbeddingEngine {
  constructor(private readonly provider: EmbeddingProvider) {}

  async encode(text: string): Promise<number[]> {
    if (!text.trim()) throw new Error("Cannot embed empty context");
    const vector = Array.from(await this.provider.embed(text));
    return normalize(vector);
  }
}

/** Exact flat k-NN index. It is deterministic and can later be backed by HNSW without changing the API. */
export class VectorMemoryIndex<T = unknown> {
  private readonly records = new Map<string, EmbeddingRecord<T>>();

  constructor(private readonly dimension: number, private readonly maxRecords = 10000) {
    if (!Number.isInteger(dimension) || dimension < 2) throw new Error("Invalid vector dimension");
    if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error("Invalid maxRecords");
  }

  upsert(record: EmbeddingRecord<T>): void {
    if (record.vector.length !== this.dimension) throw new Error("Vector dimension mismatch");
    const vector = normalize(record.vector);
    const existing = this.records.has(record.id);
    if (!existing && this.records.size >= this.maxRecords) this.gc();
    if (!existing && this.records.size >= this.maxRecords) throw new Error("Vector memory capacity exhausted");
    this.records.set(record.id, { ...record, vector });
  }

  search(namespace: string, query: readonly number[], k = 5, now = Date.now()): VectorSearchResult<T>[] {
    if (query.length !== this.dimension) throw new Error("Query vector dimension mismatch");
    if (!Number.isInteger(k) || k < 1) throw new Error("Invalid k");
    const candidates: VectorSearchResult<T>[] = [];
    for (const record of this.records.values()) {
      if (record.namespace !== namespace) continue;
      if (record.expiresAt !== undefined && record.expiresAt <= now) continue;
      candidates.push({ id: record.id, namespace, score: cosineSimilarity(record.vector, query), payload: record.payload });
    }
    return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
  }

  delete(id: string): boolean { return this.records.delete(id); }

  gc(now = Date.now()): number {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number { return this.records.size; }
}

export interface KnowledgeItem<T = unknown> {
  id: string;
  namespace: string;
  content: string;
  payload: T;
  ttlMs?: number;
}

export class CrossAgentKnowledgeBus<T = unknown> {
  constructor(private readonly embeddings: ContextEmbeddingEngine, private readonly index: VectorMemoryIndex<T>) {}

  async publish(item: KnowledgeItem<T>, now = Date.now()): Promise<void> {
    const vector = await this.embeddings.encode(item.content);
    this.index.upsert({ id: item.id, namespace: item.namespace, vector, payload: item.payload, createdAt: now, expiresAt: item.ttlMs === undefined ? undefined : now + item.ttlMs });
  }

  async query(namespace: string, text: string, k = 5, now = Date.now()): Promise<VectorSearchResult<T>[]> {
    const vector = await this.embeddings.encode(text);
    this.index.gc(now);
    return this.index.search(namespace, vector, k, now);
  }
}
