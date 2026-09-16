/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Float32 SoA Vector Arena
 * File: 1.brain/vector_arena.ts
 * Version: 1.0.0
 *
 * Structure-of-Arrays (SoA) dense vector arena. Every vector lives in one
 * contiguous Float32Array (row-major, `dimensions` per row) with cached L2
 * norms, so a search is a linear sweep over flat memory — no boxed number[],
 * no per-record objects, no full-sort allocation (bounded top-k selection).
 *
 * A dense-prefix invariant (swap-with-last removal) keeps rows 0..count-1
 * contiguous, so the whole matrix can be handed to the native Rust kernel
 * (0.kernel SimdEngine/MmapMatrix `dotBatch`) as a single zero-copy slice.
 * When the napi addon has been built it is loaded lazily and used for the
 * score pass; otherwise a JIT-friendly scalar loop runs.
 * =============================================================================
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export interface ArenaSearchHit {
  row: number;
  score: number;
}

/** Native kernel dot-product batch: query x dense matrix -> row scores. */
export interface NativeDotBatch {
  (query: Float32Array, matrix: Float32Array, dims: number): Float32Array | null;
}

export interface VectorArenaOptions {
  dimensions: number;
  capacity?: number;
  trackHeat?: boolean;
}

export interface ArenaRowSnapshot {
  id: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  vector: number[];
}

const DEFAULT_CAPACITY = 1 << 16;

export class VectorArena {
  private data: Float32Array;
  private norms: Float32Array;
  private heat: Uint32Array;
  private createdAt: Float64Array;
  private readonly dims: number;
  private capacity: number;
  private used = 0;
  private readonly trackHeat: boolean;
  private rowOfId = new Map<string, number>();
  private idOfRow: Array<string | null> = [];
  private metaOfRow: Array<Record<string, unknown> | null> = [];
  private native: NativeDotBatch | null = null;
  private triedNative = false;

  constructor(options: VectorArenaOptions) {
    this.dims = options.dimensions;
    if (this.dims < 1) throw new Error('VectorArena dimensions must be >= 1');
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (this.capacity < 1) throw new Error('VectorArena capacity must be >= 1');
    this.trackHeat = options.trackHeat ?? true;
    this.data = new Float32Array(this.capacity * this.dims);
    this.norms = new Float32Array(this.capacity);
    this.heat = new Uint32Array(this.capacity);
    this.createdAt = new Float64Array(this.capacity);
  }

  /** Install an explicit native dotBatch (zero-copy matrix slice). */
  public attachNative(fn: NativeDotBatch | null): void {
    this.native = fn;
  }

  /**
   * Lazily probe the built 0.kernel napi addon
   * (`0.kernel/target/release/klyn_kernel_core.*.node`). No-op when absent.
   */
  public tryAttachNative(): void {
    if (this.triedNative) return;
    this.triedNative = true;
    try {
      const dir = join(process.cwd(), '0.kernel', 'target', 'release');
      if (!existsSync(dir)) return;
      const file = readdirSync(dir).find((f) => f.endsWith('.node') && f.startsWith('klyn_kernel_core'));
      if (!file) return;
      const require_ = createRequire(join(process.cwd(), 'package.json'));
      const mod = require_(join(dir, file)) as { dot_batch?: NativeDotBatch };
      if (typeof mod.dot_batch === 'function') {
        this.native = mod.dot_batch;
      }
    } catch {
      this.native = null;
    }
  }

  public get dimensions(): number {
    return this.dims;
  }

  public get count(): number {
    return this.used;
  }

  public get nativeAccel(): boolean {
    return this.native !== null;
  }

  public has(id: string): boolean {
    return this.rowOfId.has(id);
  }

  /** Add or replace a vector; returns its row. */
  public upsert(
    id: string,
    vector: ArrayLike<number>,
    metadata: Record<string, unknown> = {},
    createdAt = Date.now()
  ): number {
    const existing = this.rowOfId.get(id);
    const row = existing ?? this.allocRow();
    if (existing === undefined) {
      this.idOfRow[row] = id;
      this.rowOfId.set(id, row);
    }
    this.metaOfRow[row] = metadata;
    this.createdAt[row] = createdAt;
    this.writeRow(row, vector);
    return row;
  }

  public getRow(id: string): number {
    const row = this.rowOfId.get(id);
    return row === undefined ? -1 : row;
  }

  public idAt(row: number): string {
    return this.idOfRow[row]!;
  }

  public metaAt(row: number): Record<string, unknown> | null {
    return this.metaOfRow[row];
  }

  public createdAtAt(row: number): number {
    return this.createdAt[row];
  }

  /** Materialized copy of a row as a plain number[] (persistence path). */
  public getVector(id: string): number[] | null {
    const row = this.rowOfId.get(id);
    if (row === undefined) return null;
    const out = new Array<number>(this.dims);
    const off = row * this.dims;
    for (let i = 0; i < this.dims; i++) out[i] = this.data[off + i];
    return out;
  }

  public getMetadata(id: string): Record<string, unknown> | null {
    const row = this.rowOfId.get(id);
    return row === undefined ? null : this.metaOfRow[row];
  }

  /** Zero-copy read view of a row. */
  public rowView(row: number): Float32Array {
    return this.data.subarray(row * this.dims, (row + 1) * this.dims);
  }

  public heatOf(row: number): number {
    return this.heat[row];
  }

  /** Swap-with-last removal keeps the dense prefix [0, count) contiguous. */
  public remove(id: string): boolean {
    const row = this.rowOfId.get(id);
    if (row === undefined) return false;
    const last = this.used - 1;
    if (row !== last) {
      const dst = row * this.dims;
      const src = last * this.dims;
      for (let i = 0; i < this.dims; i++) this.data[dst + i] = this.data[src + i];
      this.norms[row] = this.norms[last];
      this.heat[row] = this.heat[last];
      this.createdAt[row] = this.createdAt[last];
      const movedId = this.idOfRow[last]!;
      this.idOfRow[row] = movedId;
      this.metaOfRow[row] = this.metaOfRow[last];
      this.rowOfId.set(movedId, row);
    }
    this.idOfRow[last] = null;
    this.metaOfRow[last] = null;
    this.rowOfId.delete(id);
    this.used--;
    return true;
  }

  public clear(): void {
    this.data.fill(0);
    this.norms.fill(0);
    this.heat.fill(0);
    this.rowOfId.clear();
    this.idOfRow.length = 0;
    this.metaOfRow.length = 0;
    this.used = 0;
  }

  /**
   * Exact cosine similarity top-k over the dense prefix.
   * Returns { row, score } descending. Optional metadata filter (hot-only path).
   */
  public search(
    query: ArrayLike<number>,
    topK = 5,
    filter?: (meta: Record<string, unknown>) => boolean
  ): ArenaSearchHit[] {
    const k = Math.max(1, topK | 0);
    if (this.used === 0) return [];
    const q = toFloat32(query, this.dims);
    const qn = norm(q);
    if (qn === 0) return [];

    // Native SIMD path: the dense prefix is handed over as one slice.
    if (this.native !== null && filter === undefined) {
      try {
        const raw = this.native(q, this.data.subarray(0, this.used * this.dims), this.dims);
        if (raw !== null && raw.length >= this.used) {
          return this.selectTop(raw, qn, k);
        }
      } catch {
        /* fall through to scalar */
      }
    }

    const bestScores = new Array<number>(k).fill(-Infinity);
    const bestRows = new Int32Array(k);
    for (let row = 0; row < this.used; row++) {
      if (filter !== undefined) {
        const meta = this.metaOfRow[row];
        if (!meta || !filter(meta)) continue;
      }
      const score = this.dotRow(row, q) / (qn * this.norms[row]);
      insertCandidate(bestScores, bestRows, score, row);
    }
    return materialize(bestScores, bestRows, k);
  }

  /**
   * Indices of the coldest rows (lowest heat), for compaction demotion.
   * Only invoked by background compaction, never the hot path.
   */
  public coldest(n: number): number[] {
    if (n <= 0 || this.used === 0) return [];
    const rows = new Array<number>(this.used);
    for (let r = 0; r < this.used; r++) rows[r] = r;
    rows.sort((a, b) => this.heat[a] - this.heat[b]);
    return rows.slice(0, Math.min(n, this.used));
  }

  /** Full snapshot for persistence / compaction training. */
  public snapshot(): ArenaRowSnapshot[] {
    const out: ArenaRowSnapshot[] = [];
    for (let row = 0; row < this.used; row++) {
      out.push({
        id: this.idOfRow[row]!,
        metadata: this.metaOfRow[row] ?? {},
        createdAt: this.createdAt[row],
        vector: this.getVector(this.idOfRow[row]!)!,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private allocRow(): number {
    if (this.used >= this.capacity) this.grow();
    const row = this.used++;
    this.norms[row] = 0;
    this.heat[row] = 0;
    return row;
  }

  private grow(): void {
    const next = this.capacity * 2;
    const nd = new Float32Array(next * this.dims);
    nd.set(this.data);
    this.data = nd;
    const nn = new Float32Array(next);
    nn.set(this.norms);
    this.norms = nn;
    const nh = new Uint32Array(next);
    nh.set(this.heat);
    this.heat = nh;
    const nc = new Float64Array(next);
    nc.set(this.createdAt);
    this.createdAt = nc;
    this.capacity = next;
  }

  private writeRow(row: number, v: ArrayLike<number>): void {
    const off = row * this.dims;
    let sum = 0;
    for (let i = 0; i < this.dims; i++) {
      const x = v[i] ?? 0;
      this.data[off + i] = x;
      sum += x * x;
    }
    this.norms[row] = Math.sqrt(sum);
  }

  private dotRow(row: number, q: Float32Array): number {
    const off = row * this.dims;
    let s = 0;
    for (let i = 0; i < this.dims; i++) s += this.data[off + i] * q[i];
    return s;
  }

  private selectTop(raw: Float32Array, qn: number, k: number): ArenaSearchHit[] {
    const bestScores = new Array<number>(k).fill(-Infinity);
    const bestRows = new Int32Array(k);
    for (let row = 0; row < this.used; row++) {
      const score = raw[row] / (qn * this.norms[row]);
      insertCandidate(bestScores, bestRows, score, row);
    }
    return materialize(bestScores, bestRows, k);
  }
}

// ---------------------------------------------------------------------------
// PRIVATE HELPERS
// ---------------------------------------------------------------------------

function toFloat32(v: ArrayLike<number>, dims: number): Float32Array {
  if (v instanceof Float32Array && v.length === dims) return v;
  const out = new Float32Array(dims);
  for (let i = 0; i < dims && i < v.length; i++) out[i] = v[i];
  return out;
}

function norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

function insertCandidate(bestScores: number[], bestRows: Int32Array, score: number, row: number): void {
  for (let i = 0; i < bestScores.length; i++) {
    if (score > bestScores[i]) {
      for (let j = bestScores.length - 1; j > i; j--) {
        bestScores[j] = bestScores[j - 1];
        bestRows[j] = bestRows[j - 1];
      }
      bestScores[i] = score;
      bestRows[i] = row;
      return;
    }
  }
}

function materialize(bestScores: number[], bestRows: Int32Array, k: number): ArenaSearchHit[] {
  const out: ArenaSearchHit[] = [];
  for (let i = 0; i < k; i++) {
    if (bestScores[i] === -Infinity) break;
    out.push({ row: bestRows[i], score: bestScores[i] });
  }
  return out;
}

export default VectorArena;
