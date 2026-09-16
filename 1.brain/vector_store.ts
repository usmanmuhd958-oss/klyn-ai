/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Vector Store
 * File: 1.brain/vector_store.ts
 * Version: 2.0.0
 *
 * Dependency-free vector store backed by the Float32 SoA VectorArena:
 *   - Cosine similarity search (exact, top-k) over contiguous memory with a
 *     bounded top-k selection (no full-sort, no boxed number[] per record).
 *   - Metadata-tagged records.
 *   - Optional JSON file persistence.
 *   - Deterministic hashing-based embedding helper for offline operation.
 *   - Optional two-tier compaction (f32 hot -> PQ-quantized cold) via
 *     1.brain/compaction.ts, engaged explicitly with attachCompaction().
 *
 * Public API is unchanged from v1 (upsert/get/remove/search/searchWhere/
 * count/persist/load/clear/getStats/hashEmbed) — anchors the Genesis V670
 * OmniversalMemoryArchitecture semantic layer.
 * =============================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { VectorArena } from './vector_arena.js';
import { CompactionManager } from './compaction.js';

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

const HOT_BUDGET_DEFAULT = 10_000;

export class VectorStore {
  [key: string]: any;
  private arena: VectorArena | null = null;
  private dimensions: number | null = null;
  private persistPath: string | null = null;
  private searches = 0;
  private indexHits = 0;
  private compaction: CompactionManager | null = null;
  private hotBudget = HOT_BUDGET_DEFAULT;

  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? null;
  }

  /** Add or replace a record. Returns its id. */
  public upsert(vector: number[], metadata: Record<string, unknown> = {}, id?: string): string {
    const recordId = id ?? randomUUID();
    this.ensureArena(vector.length);
    this.arena!.upsert(recordId, vector, metadata);
    return recordId;
  }

  public get(id: string): VectorRecord | undefined {
    if (this.arena && this.arena.has(id)) {
      const vector = this.arena.getVector(id)!;
      return { id, vector, metadata: this.arena.getMetadata(id) ?? {}, createdAt: this.arena.createdAtAt(this.arena.getRow(id)) };
    }
    const cold = this.compaction?.get(id);
    if (cold) {
      return { id, vector: this.compaction!.reconstruct(id) ?? [], metadata: cold.metadata, createdAt: cold.createdAt };
    }
    return undefined;
  }

  public remove(id: string): boolean {
    const removedHot = this.arena?.remove(id) ?? false;
    const removedCold = this.compaction?.remove(id) ?? false;
    return removedHot || removedCold;
  }

  /**
   * Cosine similarity search, exact top-k.
   * Returns results sorted by descending score.
   */
  public search(vector: number[], topK = 5): VectorSearchResult[] {
    this.searches++;
    if (this.dimensions === null) return [];
    if (vector.length !== this.dimensions) {
      throw new Error(`Search vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    this.maybeCompact();

    const hotHits = this.arena!.search(vector, topK);
    const coldHits = this.compaction ? this.compaction.search(vector, topK) : [];

    const merged: Array<{ score: number; hot?: number; coldId?: string }> = [];
    for (const h of hotHits) merged.push({ score: h.score, hot: h.row });
    for (const c of coldHits) merged.push({ score: c.score, coldId: c.id });
    merged.sort((a, b) => b.score - a.score);

    const results: VectorSearchResult[] = [];
    for (const m of merged.slice(0, Math.max(1, topK | 0))) {
      if (m.hot !== undefined) {
        const id = this.arena!.idAt(m.hot);
        const vector = this.arena!.getVector(id)!;
        results.push({
          record: {
            id,
            vector,
            metadata: this.arena!.metaAt(m.hot) ?? {},
            createdAt: this.arena!.createdAtAt(m.hot),
          },
          score: m.score,
        });
        if (m.score > 0) this.indexHits++;
      } else if (m.coldId !== undefined && this.compaction) {
        const cold = this.compaction.get(m.coldId);
        if (cold) {
          results.push({
            record: { id: m.coldId, vector: this.compaction.reconstruct(m.coldId) ?? [], metadata: cold.metadata, createdAt: cold.createdAt },
            score: m.score,
          });
          if (m.score > 0) this.indexHits++;
        }
      }
    }
    return results;
  }

  /** Search with an optional metadata filter applied before scoring. */
  public searchWhere(
    vector: number[],
    filter: (metadata: Record<string, unknown>) => boolean,
    topK = 5
  ): VectorSearchResult[] {
    this.searches++;
    if (this.dimensions === null || this.arena === null) return [];
    const hits = this.arena.search(vector, topK, filter);
    const results: VectorSearchResult[] = [];
    for (const h of hits) {
      const id = this.arena.idAt(h.row);
      results.push({
        record: {
          id,
          vector: this.arena.getVector(id)!,
          metadata: this.arena.metaAt(h.row) ?? {},
          createdAt: this.arena.createdAtAt(h.row),
        },
        score: h.score,
      });
      if (h.score > 0) this.indexHits++;
    }
    return results;
  }

  public get count(): number {
    return (this.arena?.count ?? 0) + (this.compaction?.size ?? 0);
  }

  /**
   * Engage two-tier compaction. `hotBudget` is the max exact f32 rows kept in
   * the arena; the coldest overflow rows are PQ-quantized into the cold tier
   * on subsequent searches. `trainSamples` rows are used to fit codebooks.
   */
  public attachCompaction(manager: CompactionManager, hotBudget = HOT_BUDGET_DEFAULT): void {
    this.compaction = manager;
    this.hotBudget = hotBudget;
    if (this.arena && this.arena.count >= 2 && !manager.trained) {
      const rows = this.arena.count;
      const sample = this.arena.snapshot();
      const train = new Float32Array(rows * this.dimensions!);
      for (let r = 0; r < rows; r++) {
        train.set(sample[r].vector, r * this.dimensions!);
      }
      manager.train(train, rows);
    }
  }

  public async persist(): Promise<void> {
    if (!this.persistPath || !this.arena) return;
    try {
      await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
      const snapshot = {
        dimensions: this.dimensions,
        records: this.arena.snapshot().map((r) => ({
          id: r.id,
          vector: r.vector,
          metadata: r.metadata,
          createdAt: r.createdAt,
        })),
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
      this.ensureArena(snapshot.dimensions);
      for (const record of snapshot.records) {
        this.arena!.upsert(record.id, record.vector, record.metadata, record.createdAt);
      }
      return snapshot.records.length;
    } catch {
      return 0;
    }
  }

  public clear(): void {
    this.arena?.clear();
    this.dimensions = null;
  }

  public getStats(): VectorStoreStats {
    return {
      count: this.count,
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

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private ensureArena(dims: number): void {
    if (this.dimensions === null) {
      this.dimensions = dims;
    } else if (dims !== this.dimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimensions}, got ${dims}`);
    }
    if (!this.arena) {
      this.arena = new VectorArena({ dimensions: dims });
      this.arena.tryAttachNative();
    }
  }

  private maybeCompact(): void {
    if (!this.compaction || !this.arena || this.arena.count <= this.hotBudget) return;
    if (!this.compaction.trained) {
      const rows = this.arena.snapshot();
      const train = new Float32Array(rows.length * this.dimensions!);
      for (let r = 0; r < rows.length; r++) train.set(rows[r].vector, r * this.dimensions!);
      this.compaction.train(train, rows.length);
    }
    const overflow = this.arena.count - this.hotBudget;
    const coldest = this.arena.coldest(overflow);
    for (const row of coldest) {
      const id = this.arena.idAt(row);
      this.compaction.add(id, this.arena.rowView(row), this.arena.metaAt(row) ?? {}, this.arena.heatOf(row), this.arena.createdAtAt(row));
      this.arena.remove(id);
    }
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

export default VectorStore;
