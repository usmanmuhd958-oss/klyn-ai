/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Working Memory
 * File: 1.brain/memory.ts
 * Version: 1.1.0
 *
 * Short-term working memory for the brain: key/value recall with recency
 * scoring, plus similarity lookup through the vector store.
 *
 * Phase 5: the slot store is now backed by 3.memory/unified_memory.ts, whose
 * O(1) doubly-linked-list LRU eviction replaces the previous O(N) evictOldest
 * scan. The evicted key is forwarded to the vector index through onEvict so
 * the arena never keeps orphaned rows. Public API unchanged.
 * =============================================================================
 */

import { VectorStore } from './vector_store.js';
import { UnifiedMemory } from '../3.memory/unified_memory.js';

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
  private store: UnifiedMemory;
  private maxSlots: number;
  private vectorIndex: VectorStore | null;
  private vectorDimensions: number;

  constructor(options: MemoryOptions = {}) {
    this.maxSlots = options.maxSlots ?? 256;
    this.enableVectorIndex = options.enableVectorIndex ?? true;
    this.vectorDimensions = options.vectorDimensions ?? 128;
    this.store = new UnifiedMemory({
      maxEntries: this.maxSlots,
      onEvict: (key) => this.vectorIndex?.remove(key),
    });
    this.vectorIndex = this.enableVectorIndex ? new VectorStore() : null;
  }

  /** Save a value into working memory (LRU evicts at capacity). */
  public async save(key: string, value: unknown): Promise<void> {
    await this.store.store(key, value, { tags: ['working-memory'] });

    if (this.vectorIndex) {
      const embedding = VectorStore.hashEmbed(`${key}:${JSON.stringify(value)}`, this.vectorDimensions);
      this.vectorIndex.upsert(embedding, { key, kind: 'working-memory' }, key);
    }
  }

  /** Get a value, updating recency. */
  public async get(key: string): Promise<unknown> {
    const value = await this.store.retrieve(key);
    return value ?? null;
  }

  /** Check existence without touching recency. */
  public has(key: string): boolean {
    return this.store.has(key);
  }

  /** Delete a slot. */
  public async forget(key: string): Promise<boolean> {
    const removed = await this.store.delete(key);
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
    const out: Array<{ key: string; score: number }> = [];
    for (const hit of hits) {
      if (!this.store.has(hit.record.id)) continue;
      out.push({ key: hit.record.id, score: Number(hit.score.toFixed(4)) });
    }
    return out;
  }

  /** Snapshot of working memory state. */
  public async snapshot(): Promise<MemorySnapshot> {
    const keys = await this.store.searchByTags(['working-memory']);
    const slots: Array<{ key: string; value: unknown; lastAccessed: number; accessCount: number }> = [];
    for (const key of keys) {
      const entry = this.store.getEntry(key);
      if (!entry) continue;
      slots.push({
        key,
        value: entry.value,
        lastAccessed: entry.updatedAt,
        accessCount: entry.accessCount,
      });
    }
    slots.sort((a, b) => b.lastAccessed - a.lastAccessed);
    return { slots, vectorIndexCount: this.vectorIndex?.count ?? 0 };
  }

  public get size(): number {
    return this.store.size;
  }

  public async clear(): Promise<void> {
    await this.store.clear();
    this.vectorIndex?.clear();
  }
}

export default Memory;
