/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Vector Store
 * File: 1.brain/vector_store.ts
 * Version: 1.0.0
 *
 * Dependency-free vector store with:
 *   - Cosine similarity search (exact, top-k).
 *   - Metadata-tagged records.
 *   - Optional JSON file persistence.
 *   - Deterministic hashing-based embedding helper for offline operation.
 *
 * Anchors the Genesis V670 OmniversalMemoryArchitecture semantic layer.
 * =============================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface VectorSearchResult {
  record: VectorRecord;
  score: number;
}

export interface VectorStoreStats {
  count: number;
  dimensions: number | null;
  persisted: boolean;
  searches: number;
  indexHits: number;
}

export class VectorStore {
  [key: string]: any;
  private records = new Map<string, VectorRecord>();
  private dimensions: number | null = null;
  private persistPath: string | null = null;
  private searches = 0;
  private indexHits = 0;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? null;
  }

  /** Add or replace a record. Returns its id. */
  public upsert(vector: number[], metadata: Record<string, unknown> = {}, id?: string): string {
    const recordId = id ?? randomUUID();
    if (this.dimensions === null) {
      this.dimensions = vector.length;
    } else if (vector.length !== this.dimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }

    const record: VectorRecord = {
      id: recordId,
      vector,
      metadata,
      createdAt: Date.now(),
    };
    this.records.set(recordId, record);
    return recordId;
  }

  public get(id: string): VectorRecord | undefined {
    return this.records.get(id);
  }

  public remove(id: string): boolean {
    return this.records.delete(id);
  }

  /**
   * Cosine similarity search, exact top-k.
   * Returns results sorted by descending score.
   */
  public search(vector: number[], topK = 5): VectorSearchResult[] {
    this.searches++;
    if (vector.length !== (this.dimensions ?? vector.length)) {
      throw new Error(`Search vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    if (this.records.size === 0) return [];

    const queryNorm = norm(vector);
    const results: VectorSearchResult[] = [];

    for (const record of this.records.values()) {
      const score = cosineSimilarity(vector, record.vector, queryNorm);
      if (score > 0) this.indexHits++;
      results.push({ record, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Search with an optional metadata filter applied before scoring. */
  public searchWhere(
    vector: number[],
    filter: (metadata: Record<string, unknown>) => boolean,
    topK = 5
  ): VectorSearchResult[] {
    this.searches++;
    const queryNorm = norm(vector);
    const results: VectorSearchResult[] = [];

    for (const record of this.records.values()) {
      if (!filter(record.metadata)) continue;
      const score = cosineSimilarity(vector, record.vector, queryNorm);
      if (score > 0) this.indexHits++;
      results.push({ record, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  public get count(): number {
    return this.records.size;
  }

  public async persist(): Promise<void> {
    if (!this.persistPath) return;
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      const snapshot = {
        dimensions: this.dimensions,
        records: Array.from(this.records.values()),
      };
      const tmp = `${this.persistPath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot), 'utf8');
      await fs.rename(tmp, this.persistPath);
    } catch (err) {
      process.stderr.write(`[VectorStore] persist failed: ${(err as Error).message}\n`);
    }
  }

  public async load(): Promise<number> {
    if (!this.persistPath) return 0;
    try {
      const raw = await fs.readFile(this.persistPath, 'utf8');
      const snapshot = JSON.parse(raw) as { dimensions: number; records: VectorRecord[] };
      this.dimensions = snapshot.dimensions;
      for (const record of snapshot.records) {
        this.records.set(record.id, record);
      }
      return snapshot.records.length;
    } catch {
      return 0;
    }
  }

  public clear(): void {
    this.records.clear();
    this.dimensions = null;
  }

  public getStats(): VectorStoreStats {
    return {
      count: this.records.size,
      dimensions: this.dimensions,
      persisted: this.persistPath !== null,
      searches: this.searches,
      indexHits: this.indexHits,
    };
  }

  /**
   * Deterministic content-hash embedding. Maps arbitrary strings into a
   * fixed-dimension unit vector using SHA-256 shingles. Not a semantic model,
   * but a stable offline fallback for tests and dependency-free operation.
   */
  public static hashEmbed(text: string, dimensions = 128): number[] {
    const vec = new Array<number>(dimensions).fill(0);
    const chunks = text.match(/.{1,4}/g) ?? [text];
    let seed = 0;
    for (const chunk of chunks) {
      const digest = createHash('sha256').update(`${seed}:${chunk}`).digest();
      for (let i = 0; i < dimensions; i++) {
        vec[i] += digest[i % digest.length] / 255;
      }
      seed++;
    }
    const n = norm(vec);
    return n === 0 ? vec : vec.map((v) => v / n);
  }
}

// ---------------------------------------------------------------------------
// PRIVATE HELPERS
// ---------------------------------------------------------------------------

function norm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[], aNorm: number): number {
  if (aNorm === 0 || b.length === 0) return 0;
  let dot = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    bNorm += b[i] * b[i];
  }
  bNorm = Math.sqrt(bNorm);
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (aNorm * bNorm);
}

export default VectorStore;
