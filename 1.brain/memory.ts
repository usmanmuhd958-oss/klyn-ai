/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Working Memory
 * File: 1.brain/memory.ts
 * Version: 1.0.0
 *
 * Short-term working memory for the brain: key/value recall with recency
 * scoring, plus similarity lookup through the vector store.
 * =============================================================================
 */

import { VectorStore } from './vector_store.js';

export interface MemoryOptions {
  maxSlots?: number;
  enableVectorIndex?: boolean;
  vectorDimensions?: number;
}

export interface MemorySnapshot {
  slots: Array<{ key: string; value: unknown; lastAccessed: number; accessCount: number }>;
  vectorIndexCount: number;
}

export class Memory {
  [key: string]: any;
  private slots = new Map<
    string,
    { value: unknown; lastAccessed: number; accessCount: number }
  >();
  private maxSlots: number;
  private vectorIndex: VectorStore | null;
  private vectorDimensions: number;

  constructor(options: MemoryOptions = {}) {
    this.maxSlots = options.maxSlots ?? 256;
    this.enableVectorIndex = options.enableVectorIndex ?? true;
    this.vectorDimensions = options.vectorDimensions ?? 128;
    this.vectorIndex = this.enableVectorIndex ? new VectorStore() : null;
  }

  /** Save a value into working memory. */
  public async save(key: string, value: unknown): Promise<void> {
    if (this.slots.size >= this.maxSlots && !this.slots.has(key)) {
      this.evictOldest();
    }
    this.slots.set(key, { value, lastAccessed: Date.now(), accessCount: 0 });

    if (this.vectorIndex) {
      const embedding = VectorStore.hashEmbed(`${key}:${JSON.stringify(value)}`, this.vectorDimensions);
      this.vectorIndex.upsert(embedding, { key, kind: 'working-memory' }, key);
    }
  }

  /** Get a value, updating recency. */
  public async get(key: string): Promise<unknown> {
    const slot = this.slots.get(key);
    if (!slot) return null;
    slot.lastAccessed = Date.now();
    slot.accessCount++;
    return slot.value;
  }

  /** Check existence without touching recency. */
  public has(key: string): boolean {
    return this.slots.has(key);
  }

  /** Delete a slot. */
  public async forget(key: string): Promise<boolean> {
    const removed = this.slots.delete(key);
    if (this.vectorIndex) {
      this.vectorIndex.remove(key);
    }
    return removed;
  }

  /**
   * Find the most similar remembered values for a query string, ranked by
   * cosine similarity of their content-hash embeddings.
   */
  public async findSimilar(query: string, topK = 3): Promise<Array<{ key: string; score: number }>> {
    if (!this.vectorIndex) return [];
    const embedding = VectorStore.hashEmbed(query, this.vectorDimensions);
    const hits = this.vectorIndex.search(embedding, topK);
    return hits
      .filter((hit) => this.slots.has(hit.record.id))
      .map((hit) => ({ key: hit.record.id, score: Number(hit.score.toFixed(4)) }));
  }

  /** Snapshot of working memory state. */
  public snapshot(): MemorySnapshot {
    const slots = Array.from(this.slots.entries()).map(([key, slot]) => ({
      key,
      value: slot.value,
      lastAccessed: slot.lastAccessed,
      accessCount: slot.accessCount,
    }));
    slots.sort((a, b) => b.lastAccessed - a.lastAccessed);
    return { slots, vectorIndexCount: this.vectorIndex?.count ?? 0 };
  }

  public get size(): number {
    return this.slots.size;
  }

  public async clear(): Promise<void> {
    this.slots.clear();
    this.vectorIndex?.clear();
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldest = Number.MAX_SAFE_INTEGER;
    for (const [key, slot] of this.slots) {
      if (slot.lastAccessed < oldest) {
        oldest = slot.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.slots.delete(oldestKey);
      this.vectorIndex?.remove(oldestKey);
    }
  }
}

export default Memory;
