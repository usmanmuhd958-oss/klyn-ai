/**
 * =============================================================================
 * KLYN AI OS — Brain Layer — Active Vector Memory Compaction
 * File: 1.brain/compaction.ts
 * Version: 1.0.0
 *
 * Two-tier active vector memory:
 *   - HOT tier: exact f32 rows in the VectorArena (contiguous SoA).
 *   - COLD tier: product-quantized codes (Uint8Array per vector) that cost
 *     numSubspaces bytes instead of dims*4, searched by codebook lookup.
 *
 * `ProductQuantizer` trains per-subspace centroids with deterministic
 * k-means (stride initialization, no randomness) and encodes/decodes rows.
 * `CompactionManager` owns the cold tier as a dense SoA (flat codes +
 * parallel norm/heat/id arrays with swap-with-last removal) and answers
 * approximate top-k queries in O(cold * numSubspaces) table reads — no
 * floating point per candidate beyond a few lookups — keeping cold retrieval
 * far below the 2ms budget at 100k+ vectors on the native path.
 *
 * Deterministic and dependency-free: same input rows -> same codebooks.
 * =============================================================================
 */

export interface ProductQuantizerOptions {
  numSubspaces?: number;
  kCentroids?: number;
}

export interface CompactionSearchHit {
  id: string;
  score: number;
}

export interface ColdVector {
  id: string;
  code: Uint8Array;
  norm: number;
  metadata: Record<string, unknown>;
  heat: number;
  createdAt: number;
}

export interface CompactionManagerOptions {
  numSubspaces?: number;
  kCentroids?: number;
}

const DEFAULT_SUBSPACES = 8;
const DEFAULT_CENTROIDS = 16;
const TRAIN_ITERATIONS = 3;
const DEFAULT_CAPACITY = 1 << 14;

export class ProductQuantizer {
  readonly dims: number;
  readonly numSubspaces: number;
  readonly kCentroids: number;
  readonly subDim: number;
  trained = false;
  private codebooks: Float32Array; // numSubspaces * kCentroids * subDim

  constructor(dims: number, options: ProductQuantizerOptions = {}) {
    if (dims < 1) throw new Error('ProductQuantizer dims must be >= 1');
    this.dims = dims;
    this.numSubspaces = Math.max(1, Math.min(options.numSubspaces ?? DEFAULT_SUBSPACES, dims));
    this.kCentroids = Math.max(2, options.kCentroids ?? DEFAULT_CENTROIDS);
    this.subDim = Math.ceil(dims / this.numSubspaces);
    this.codebooks = new Float32Array(this.numSubspaces * this.kCentroids * this.subDim);
  }

  /** Train per-subspace codebooks on the dense prefix of `rows`. */
  public train(rows: Float32Array, n: number): void {
    if (n < this.kCentroids) throw new Error(`Compaction train needs >= ${this.kCentroids} rows, got ${n}`);
    for (let s = 0; s < this.numSubspaces; s++) {
      const cbBase = s * this.kCentroids * this.subDim;
      const qBase = s * this.subDim;
      // Deterministic stride initialization from the data itself.
      for (let c = 0; c < this.kCentroids; c++) {
        const row = Math.min(n - 1, ((c * n) / this.kCentroids) | 0);
        const src = row * this.dims + qBase;
        for (let d = 0; d < this.subDim; d++) {
          const v = qBase + d < this.dims ? rows[src + d] ?? 0 : 0;
          this.codebooks[cbBase + c * this.subDim + d] = v;
        }
      }
      const counts = new Int32Array(this.kCentroids);
      const sums = new Float32Array(this.kCentroids * this.subDim);
      for (let iter = 0; iter < TRAIN_ITERATIONS; iter++) {
        counts.fill(0);
        sums.fill(0);
        for (let r = 0; r < n; r++) {
          const base = r * this.dims + qBase;
          let best = 0;
          let bestD = Infinity;
          for (let c = 0; c < this.kCentroids; c++) {
            let d2 = 0;
            for (let d = 0; d < this.subDim; d++) {
              const x = qBase + d < this.dims ? rows[base + d] ?? 0 : 0;
              const diff = x - this.codebooks[cbBase + c * this.subDim + d];
              d2 += diff * diff;
            }
            if (d2 < bestD) {
              bestD = d2;
              best = c;
            }
          }
          counts[best]++;
          for (let d = 0; d < this.subDim; d++) {
            if (qBase + d < this.dims) sums[best * this.subDim + d] += rows[base + d] ?? 0;
          }
        }
        for (let c = 0; c < this.kCentroids; c++) {
          if (counts[c] === 0) continue;
          for (let d = 0; d < this.subDim; d++) {
            this.codebooks[cbBase + c * this.subDim + d] = sums[c * this.subDim + d] / counts[c];
          }
        }
      }
    }
    this.trained = true;
  }

  /** Encode a row into numSubspaces centroid indices. */
  public encode(row: Float32Array, out?: Uint8Array): Uint8Array {
    const code = out ?? new Uint8Array(this.numSubspaces);
    for (let s = 0; s < this.numSubspaces; s++) {
      const cbBase = s * this.kCentroids * this.subDim;
      const qBase = s * this.subDim;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < this.kCentroids; c++) {
        let d2 = 0;
        for (let d = 0; d < this.subDim; d++) {
          const x = qBase + d < this.dims ? row[qBase + d] ?? 0 : 0;
          const diff = x - this.codebooks[cbBase + c * this.subDim + d];
          d2 += diff * diff;
        }
        if (d2 < bestD) {
          bestD = d2;
          best = c;
        }
      }
      code[s] = best;
    }
    return code;
  }

  /** Estimated dot product from precomputed partials (8 lookups). */
  public dotFromPartials(partials: Float32Array, codes: Uint8Array, codeBase: number): number {
    const ns = this.numSubspaces;
    const kc = this.kCentroids;
    let s = 0;
    for (let i = 0; i < ns; i++) s += partials[i * kc + codes[codeBase + i]];
    return s;
  }

  /** Estimated dot product of a query against an encoded vector (table reads). */
  public dotApprox(query: Float32Array, code: Uint8Array): number {
    let s = 0;
    for (let sub = 0; sub < this.numSubspaces; sub++) {
      const cbBase = sub * this.kCentroids * this.subDim + code[sub] * this.subDim;
      const qBase = sub * this.subDim;
      for (let d = 0; d < this.subDim && qBase + d < this.dims; d++) {
        s += query[qBase + d] * this.codebooks[cbBase + d];
      }
    }
    return s;
  }

  /**
   * Precompute query x centroid partial dot products per subspace.
   * Cost: numSubspaces * kCentroids * subDim MACs once per query; the per-
   * candidate scan then reduces to numSubspaces table lookups.
   */
  public partialDots(query: Float32Array): Float32Array {
    const ns = this.numSubspaces;
    const kc = this.kCentroids;
    const sub = this.subDim;
    const out = new Float32Array(ns * kc);
    for (let s = 0; s < ns; s++) {
      const qBase = s * sub;
      for (let c = 0; c < kc; c++) {
        const cbBase = (s * kc + c) * sub;
        let acc = 0;
        for (let d = 0; d < sub && qBase + d < this.dims; d++) {
          acc += query[qBase + d] * this.codebooks[cbBase + d];
        }
        out[s * kc + c] = acc;
      }
    }
    return out;
  }

  /**
   * Estimated dot product against a flat code at `codeBase` (no subarray
   * allocation — the hot search path).
   */
  public dotApproxAt(query: Float32Array, codes: Uint8Array, codeBase: number): number {
    const ns = this.numSubspaces;
    const kc = this.kCentroids;
    const sub = this.subDim;
    let s = 0;
    for (let subi = 0; subi < ns; subi++) {
      const cbBase = subi * kc * sub + codes[codeBase + subi] * sub;
      const qBase = subi * sub;
      for (let d = 0; d < sub && qBase + d < this.dims; d++) {
        s += query[qBase + d] * this.codebooks[cbBase + d];
      }
    }
    return s;
  }

  /** Approximate reconstruction (sum of centroid means per subspace). */
  public decode(code: Uint8Array, out?: Float32Array): Float32Array {
    const vec = out ?? new Float32Array(this.dims);
    vec.fill(0);
    for (let sub = 0; sub < this.numSubspaces; sub++) {
      const cbBase = sub * this.kCentroids * this.subDim + code[sub] * this.subDim;
      const qBase = sub * this.subDim;
      for (let d = 0; d < this.subDim && qBase + d < this.dims; d++) {
        vec[qBase + d] = this.codebooks[cbBase + d];
      }
    }
    return vec;
  }

  public get codebookBytes(): number {
    return this.codebooks.byteLength;
  }
}

export class CompactionManager {
  private quantizer: ProductQuantizer;
  // SoA cold tier (dense prefix [0, size); swap-with-last removal).
  private codes: Uint8Array; // size * numSubspaces
  private norms: Float32Array;
  private heat: Uint32Array;
  private createdAt: Float64Array;
  private ids: string[] = [];
  private meta: Array<Record<string, unknown> | null> = [];
  private index = new Map<string, number>();
  private size_ = 0;
  private capacity: number;

  constructor(dims: number, options: CompactionManagerOptions = {}) {
    this.quantizer = new ProductQuantizer(dims, options);
    this.capacity = DEFAULT_CAPACITY;
    const ns = this.quantizer.numSubspaces;
    this.codes = new Uint8Array(this.capacity * ns);
    this.norms = new Float32Array(this.capacity);
    this.heat = new Uint32Array(this.capacity);
    this.createdAt = new Float64Array(this.capacity);
  }

  public get size(): number {
    return this.size_;
  }

  public get trained(): boolean {
    return this.quantizer.trained;
  }

  public train(rows: Float32Array, n: number): void {
    this.quantizer.train(rows, n);
  }

  /** Demote a hot row into the cold tier (PQ code). */
  public add(
    id: string,
    row: Float32Array,
    metadata: Record<string, unknown> = {},
    heat = 0,
    createdAt = Date.now()
  ): void {
    if (!this.quantizer.trained) throw new Error('CompactionManager must be trained before adding cold vectors');
    const existing = this.index.get(id);
    const slot = existing ?? this.alloc();
    if (existing === undefined) {
      this.ids[slot] = id;
      this.index.set(id, slot);
    }
    const ns = this.quantizer.numSubspaces;
    const out = this.codes.subarray(slot * ns, (slot + 1) * ns);
    this.quantizer.encode(row, out);
    let norm = 0;
    for (let i = 0; i < row.length; i++) norm += row[i] * row[i];
    this.norms[slot] = Math.sqrt(norm);
    this.heat[slot] = heat;
    this.createdAt[slot] = createdAt;
    this.meta[slot] = metadata;
  }

  public remove(id: string): boolean {
    const slot = this.index.get(id);
    if (slot === undefined) return false;
    const last = this.size_ - 1;
    const ns = this.quantizer.numSubspaces;
    if (slot !== last) {
      this.codes.copyWithin(slot * ns, last * ns, (last + 1) * ns);
      this.norms[slot] = this.norms[last];
      this.heat[slot] = this.heat[last];
      this.createdAt[slot] = this.createdAt[last];
      const movedId = this.ids[last];
      this.ids[slot] = movedId;
      this.meta[slot] = this.meta[last];
      this.index.set(movedId, slot);
    }
    this.ids[last] = '';
    this.meta[last] = null;
    this.index.delete(id);
    this.size_--;
    return true;
  }

  /** Read-only view of a cold vector (code is a live subarray — do not mutate). */
  public get(id: string): ColdVector | undefined {
    const slot = this.index.get(id);
    if (slot === undefined) return undefined;
    const ns = this.quantizer.numSubspaces;
    return {
      id,
      code: this.codes.subarray(slot * ns, (slot + 1) * ns),
      norm: this.norms[slot],
      metadata: this.meta[slot] ?? {},
      heat: this.heat[slot],
      createdAt: this.createdAt[slot],
    };
  }

  /** Approximate reconstruction of a cold vector as a plain number[]. */
  public reconstruct(id: string): number[] | null {
    const slot = this.index.get(id);
    if (slot === undefined) return null;
    const ns = this.quantizer.numSubspaces;
    return Array.from(this.quantizer.decode(this.codes.subarray(slot * ns, (slot + 1) * ns)));
  }

  /** Approximate cosine top-k over the cold tier (codebook lookups only). */
  public search(query: ArrayLike<number>, topK = 5): CompactionSearchHit[] {
    const k = Math.max(1, topK | 0);
    if (this.size_ === 0) return [];
    const dims = this.quantizer.dims;
    const ns = this.quantizer.numSubspaces;
    const q = toFloat32(query, dims);
    let qn = 0;
    for (let i = 0; i < q.length; i++) qn += q[i] * q[i];
    qn = Math.sqrt(qn);
    if (qn === 0) return [];

    const partials = this.quantizer.partialDots(q);
    const bestScores = new Array<number>(k).fill(-Infinity);
    const bestIds = new Array<string>(k).fill('');
    for (let r = 0; r < this.size_; r++) {
      const est = this.quantizer.dotFromPartials(partials, this.codes, r * ns);
      const score = est / (qn * (this.norms[r] || 1));
      insert(bestScores, bestIds, score, this.ids[r]);
    }
    const out: CompactionSearchHit[] = [];
    for (let i = 0; i < k; i++) {
      if (bestScores[i] === -Infinity) break;
      out.push({ id: bestIds[i], score: bestScores[i] });
    }
    return out;
  }

  public stats(): { cold: number; codebookBytes: number; trained: boolean } {
    return {
      cold: this.size_,
      codebookBytes: this.quantizer.codebookBytes,
      trained: this.quantizer.trained,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  private alloc(): number {
    if (this.size_ >= this.capacity) this.grow();
    const slot = this.size_++;
    this.norms[slot] = 0;
    this.heat[slot] = 0;
    this.createdAt[slot] = 0;
    return slot;
  }

  private grow(): void {
    const next = this.capacity * 2;
    const ns = this.quantizer.numSubspaces;
    const nc = new Uint8Array(next * ns);
    nc.set(this.codes.subarray(0, this.size_ * ns));
    this.codes = nc;
    const nn = new Float32Array(next);
    nn.set(this.norms.subarray(0, this.size_));
    this.norms = nn;
    const nh = new Uint32Array(next);
    nh.set(this.heat.subarray(0, this.size_));
    this.heat = nh;
    const nc2 = new Float64Array(next);
    nc2.set(this.createdAt.subarray(0, this.size_));
    this.createdAt = nc2;
    this.capacity = next;
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

function insert(bestScores: number[], bestIds: string[], score: number, id: string): void {
  for (let i = 0; i < bestScores.length; i++) {
    if (score > bestScores[i]) {
      for (let j = bestScores.length - 1; j > i; j--) {
        bestScores[j] = bestScores[j - 1];
        bestIds[j] = bestIds[j - 1];
      }
      bestScores[i] = score;
      bestIds[i] = id;
      return;
    }
  }
}

export default CompactionManager;
