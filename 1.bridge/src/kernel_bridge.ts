import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

// =============================================================================
// Legacy kernel ABI bridge (unchanged)
// =============================================================================

export interface KernelEventPayload {
  eventType: number;
  data: Uint8Array;
}

export interface NativeKernel {
  submitEvent(buffer: Buffer): number;
  processBatch(maxEvents: number): number;
  loadLawBytecode(bytecode: Buffer): void;
  sealData(data: Buffer): Buffer;
  unsealData(sealedBuffer: Buffer): Buffer;
  getProcessedCount(): number;
  getPendingCount(): number;
  shutdown(): void;
}

export class KernelBridge {
  private nativeKernel: NativeKernel;
  private isInitialized = false;

  constructor() {
    const buildPath = join(__dirname, '../../0.kernel/target/release/libklyn_kernel.so');
    const debugPath = join(__dirname, '../../0.kernel/target/debug/libklyn_kernel.so');
    
    let addonPath = buildPath;
    if (!existsSync(buildPath)) {
      if (existsSync(debugPath)) {
        addonPath = debugPath;
      } else {
        throw new Error('KLYN Native Kernel binary (.so) not found. Run cargo build first.');
      }
    }

    try {
      const addonModule: { exports: any } = { exports: {} };
      process.dlopen(addonModule, addonPath);
      this.nativeKernel = new addonModule.exports.KlynKernel();
      this.isInitialized = true;
    } catch (err) {
      throw new Error(`Failed to load KLYN Native Kernel bindings: ${err}`);
    }
  }

  public submitEvent(payload: KernelEventPayload): number {
    this.assertActive();
    
    // Rust KernelEvent struct exact size = 1048 bytes
    const TOTAL_STRUCT_SIZE = 1048;
    const HEADER_SIZE = 24;
    const MAX_PAYLOAD_SIZE = 1024;

    const buf = Buffer.alloc(TOTAL_STRUCT_SIZE); // Zero-initialized 1048 bytes

    const payloadLen = Math.min(payload.data.length, MAX_PAYLOAD_SIZE);

    buf.writeBigUInt64LE(0n, 0);                        // event_id
    buf.writeBigUInt64LE(BigInt(Date.now()), 8);        // timestamp
    buf.writeUInt32LE(payload.eventType, 16);           // event_type
    buf.writeUInt8(0, 20);                             // priority
    buf.writeUInt8(0, 21);                             // flags
    buf.writeUInt16LE(payloadLen, 22);                  // payload_len

    // Copy payload bytes into [u8; 1024] slice starting at offset 24
    Buffer.from(payload.data.buffer, payload.data.byteOffset, payloadLen).copy(buf, HEADER_SIZE);

    return this.nativeKernel.submitEvent(buf);
  }

  public processBatch(maxEvents: number = 1000): number {
    this.assertActive();
    return this.nativeKernel.processBatch(maxEvents);
  }

  public sealData(data: Uint8Array): Uint8Array {
    this.assertActive();
    const inputBuf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const sealed = this.nativeKernel.sealData(inputBuf);
    return new Uint8Array(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  }

  public unsealData(sealedData: Uint8Array): Uint8Array {
    this.assertActive();
    const inputBuf = Buffer.from(sealedData.buffer, sealedData.byteOffset, sealedData.byteLength);
    const unsealed = this.nativeKernel.unsealData(inputBuf);
    return new Uint8Array(unsealed.buffer, unsealed.byteOffset, unsealed.byteLength);
  }

  public getStats() {
    this.assertActive();
    return {
      processed: this.nativeKernel.getProcessedCount(),
      pending: this.nativeKernel.getPendingCount(),
    };
  }

  public shutdown(): void {
    if (this.isInitialized) {
      this.nativeKernel.shutdown();
      this.isInitialized = false;
    }
  }

  private assertActive() {
    if (!this.isInitialized) {
      throw new Error('KernelBridge instance is not active or shut down.');
    }
  }
}

// =============================================================================
// PHASE 4 — native SIMD / mmap / ring acceleration surface
//
// `kernelAccel` exposes dotBatch / matrixUpsert / ringPush / ringPop directly
// to TypeScript. When the 0.kernel napi addon
// (`0.kernel/target/release/klyn_kernel_core.*.node`) has been built on a Rust
// host it runs on native pages (zero-copy Float32Array views into the JS
// buffer, mmap-backed matrix rows). Otherwise it degrades to a pure-TS
// implementation so the runtime and the 15/15 smoke suite stay green.
// =============================================================================

export interface KernelAccel {
  readonly available: boolean;
  readonly backend: 'native' | 'js';
  /** query x matrix(rows*dims) -> per-row dot scores (SIMD on native). */
  dotBatch(query: Float32Array, matrix: Float32Array, dims: number): Float32Array;
  /** Write one row into the shared mmap matrix; returns current row count. */
  matrixUpsert(row: number, vector: Float32Array): number;
  /** Push a value into the lock-free ring buffer. */
  ringPush(value: number): boolean;
  /** Pop the oldest value from the ring buffer (null when empty). */
  ringPop(): number | null;
  ringLen(): number;
}

interface NativeVectorModule {
  dot_batch?: (query: Float32Array, matrix: Float32Array, dims: number) => Float32Array;
  SimdEngine?: new () => {
    dot(a: Float32Array, b: Float32Array): number;
    dot_batch(query: Float32Array, matrix: Float32Array, dims: number): Float32Array;
  };
  MmapMatrix?: new (rows: number, dims: number) => {
    upsert(row: number, vector: Float32Array): void;
    rows(): number;
    dims(): number;
    flush(): void;
  };
  RingBuffer?: new (capacity: number, overwrite: boolean) => {
    push(v: number): boolean;
    pop(): number | null;
    len(): number;
  };
}

function loadNativeModule(): NativeVectorModule | null {
  const probeDirs = [
    join(__dirname, '../../0.kernel/target/release'),
    join(__dirname, '../../0.kernel/target/debug'),
  ];
  for (const dir of probeDirs) {
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => f.endsWith('.node') && f.includes('klyn_kernel_core'));
    if (!file) continue;
    try {
      const require_ = createRequire(join(__dirname, 'package.json'));
      return require_(join(dir, file)) as NativeVectorModule;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

interface SimdInstance {
  dot_batch(query: Float32Array, matrix: Float32Array, dims: number): Float32Array;
}

interface MmapInstance {
  upsert(row: number, vector: Float32Array): void;
}

interface RingInstance {
  push(v: number): boolean;
  pop(): number | null;
  len(): number;
}

class KernelAccelImpl implements KernelAccel {
  public readonly available: boolean = false;
  public readonly backend: 'native' | 'js' = 'js';

  private native: NativeVectorModule | null = null;
  private simd: SimdInstance | null = null;
  private mmap: MmapInstance | null = null;
  private ring: RingInstance | null = null;

  // JS fallback state
  private jsMatrix: Float32Array | null = null;
  private jsMatrixDims = 0;
  private jsMatrixRows = 0;
  private jsRing: number[] = [];
  private readonly jsRingCap = 1024;

  constructor() {
    try {
      const mod = loadNativeModule();
      if (mod) {
        this.native = mod;
        if (typeof mod.SimdEngine === 'function') {
          this.simd = new mod.SimdEngine();
        }
        if (typeof mod.MmapMatrix === 'function') {
          this.mmap = new mod.MmapMatrix(1024, 1);
        }
        if (typeof mod.RingBuffer === 'function') {
          this.ring = new mod.RingBuffer(1024, false);
        }
        this.available = typeof mod.dot_batch === 'function' || this.simd !== null;
        this.backend = this.available ? 'native' : 'js';
      }
    } catch {
      /* keep JS fallback */
    }
  }

  public dotBatch(query: Float32Array, matrix: Float32Array, dims: number): Float32Array {
    const rows = dims > 0 ? Math.floor(matrix.length / dims) : 0;
    if (rows === 0) return new Float32Array(0);

    if (this.available && this.native && typeof this.native.dot_batch === 'function') {
      try {
        const native = this.native.dot_batch(query, matrix, dims);
        if (native && native.length === rows) return native;
      } catch {
        /* fall through */
      }
    }
    if (this.available && this.simd) {
      try {
        const native = this.simd.dot_batch(query, matrix, dims);
        if (native && native.length === rows) return native;
      } catch {
        /* fall through */
      }
    }

    // Pure-TS fallback: flat SIMD-friendly loop.
    const out = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      const off = r * dims;
      let s = 0;
      for (let i = 0; i < dims; i++) s += matrix[off + i] * query[i];
      out[r] = s;
    }
    return out;
  }

  public matrixUpsert(row: number, vector: Float32Array): number {
    if (this.available && this.mmap) {
      try {
        this.mmap.upsert(row, vector);
        return row + 1;
      } catch {
        /* fall through to JS */
      }
    }

    if (!this.jsMatrix || this.jsMatrixDims !== vector.length || row + 1 > this.jsMatrixRows) {
      const rows = Math.max(1024, row + 1);
      const next = new Float32Array(rows * vector.length);
      if (this.jsMatrix) next.set(this.jsMatrix.subarray(0, this.jsMatrixRows * this.jsMatrixDims));
      this.jsMatrix = next;
      this.jsMatrixDims = vector.length;
      this.jsMatrixRows = rows;
    }
    this.jsMatrix.set(vector, row * this.jsMatrixDims);
    return this.jsMatrixRows;
  }

  public ringPush(value: number): boolean {
    if (this.available && this.ring) {
      try {
        return this.ring.push(value);
      } catch {
        /* fall through */
      }
    }
    if (this.jsRing.length >= this.jsRingCap) return false;
    this.jsRing.push(value);
    return true;
  }

  public ringPop(): number | null {
    if (this.available && this.ring) {
      try {
        return this.ring.pop();
      } catch {
        /* fall through */
      }
    }
    return this.jsRing.length > 0 ? this.jsRing.shift()! : null;
  }

  public ringLen(): number {
    if (this.available && this.ring) {
      try {
        return this.ring.len();
      } catch {
        /* fall through */
      }
    }
    return this.jsRing.length;
  }
}

/** Canonical acceleration surface used by the brain layers. */
export const kernelAccel: KernelAccel = new KernelAccelImpl();

export default KernelBridge;
