"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kernelAccel = exports.KernelBridge = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const module_1 = require("module");
class KernelBridge {
    nativeKernel;
    isInitialized = false;
    constructor() {
        const buildPath = (0, path_1.join)(__dirname, '../../0.kernel/target/release/libklyn_kernel.so');
        const debugPath = (0, path_1.join)(__dirname, '../../0.kernel/target/debug/libklyn_kernel.so');
        let addonPath = buildPath;
        if (!(0, fs_1.existsSync)(buildPath)) {
            if ((0, fs_1.existsSync)(debugPath)) {
                addonPath = debugPath;
            }
            else {
                throw new Error('KLYN Native Kernel binary (.so) not found. Run cargo build first.');
            }
        }
        try {
            const addonModule = { exports: {} };
            process.dlopen(addonModule, addonPath);
            this.nativeKernel = new addonModule.exports.KlynKernel();
            this.isInitialized = true;
        }
        catch (err) {
            throw new Error(`Failed to load KLYN Native Kernel bindings: ${err}`);
        }
    }
    submitEvent(payload) {
        this.assertActive();
        // Rust KernelEvent struct exact size = 1048 bytes
        const TOTAL_STRUCT_SIZE = 1048;
        const HEADER_SIZE = 24;
        const MAX_PAYLOAD_SIZE = 1024;
        const buf = Buffer.alloc(TOTAL_STRUCT_SIZE); // Zero-initialized 1048 bytes
        const payloadLen = Math.min(payload.data.length, MAX_PAYLOAD_SIZE);
        buf.writeBigUInt64LE(0n, 0); // event_id
        buf.writeBigUInt64LE(BigInt(Date.now()), 8); // timestamp
        buf.writeUInt32LE(payload.eventType, 16); // event_type
        buf.writeUInt8(0, 20); // priority
        buf.writeUInt8(0, 21); // flags
        buf.writeUInt16LE(payloadLen, 22); // payload_len
        // Copy payload bytes into [u8; 1024] slice starting at offset 24
        Buffer.from(payload.data.buffer, payload.data.byteOffset, payloadLen).copy(buf, HEADER_SIZE);
        return this.nativeKernel.submitEvent(buf);
    }
    processBatch(maxEvents = 1000) {
        this.assertActive();
        return this.nativeKernel.processBatch(maxEvents);
    }
    sealData(data) {
        this.assertActive();
        const inputBuf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const sealed = this.nativeKernel.sealData(inputBuf);
        return new Uint8Array(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    }
    unsealData(sealedData) {
        this.assertActive();
        const inputBuf = Buffer.from(sealedData.buffer, sealedData.byteOffset, sealedData.byteLength);
        const unsealed = this.nativeKernel.unsealData(inputBuf);
        return new Uint8Array(unsealed.buffer, unsealed.byteOffset, unsealed.byteLength);
    }
    getStats() {
        this.assertActive();
        return {
            processed: this.nativeKernel.getProcessedCount(),
            pending: this.nativeKernel.getPendingCount(),
        };
    }
    shutdown() {
        if (this.isInitialized) {
            this.nativeKernel.shutdown();
            this.isInitialized = false;
        }
    }
    assertActive() {
        if (!this.isInitialized) {
            throw new Error('KernelBridge instance is not active or shut down.');
        }
    }
}
exports.KernelBridge = KernelBridge;
function loadNativeModule() {
    const probeDirs = [
        (0, path_1.join)(__dirname, '../../0.kernel/target/release'),
        (0, path_1.join)(__dirname, '../../0.kernel/target/debug'),
    ];
    for (const dir of probeDirs) {
        if (!(0, fs_1.existsSync)(dir))
            continue;
        const file = (0, fs_1.readdirSync)(dir).find((f) => f.endsWith('.node') && f.includes('klyn_kernel_core'));
        if (!file)
            continue;
        try {
            const require_ = (0, module_1.createRequire)((0, path_1.join)(__dirname, 'package.json'));
            return require_((0, path_1.join)(dir, file));
        }
        catch {
            /* try the next candidate */
        }
    }
    return null;
}
class KernelAccelImpl {
    available = false;
    backend = 'js';
    native = null;
    simd = null;
    mmap = null;
    ring = null;
    // JS fallback state
    jsMatrix = null;
    jsMatrixDims = 0;
    jsMatrixRows = 0;
    jsRing = [];
    jsRingCap = 1024;
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
        }
        catch {
            /* keep JS fallback */
        }
    }
    dotBatch(query, matrix, dims) {
        const rows = dims > 0 ? Math.floor(matrix.length / dims) : 0;
        if (rows === 0)
            return new Float32Array(0);
        if (this.available && this.native && typeof this.native.dot_batch === 'function') {
            try {
                const native = this.native.dot_batch(query, matrix, dims);
                if (native && native.length === rows)
                    return native;
            }
            catch {
                /* fall through */
            }
        }
        if (this.available && this.simd) {
            try {
                const native = this.simd.dot_batch(query, matrix, dims);
                if (native && native.length === rows)
                    return native;
            }
            catch {
                /* fall through */
            }
        }
        // Pure-TS fallback: flat SIMD-friendly loop.
        const out = new Float32Array(rows);
        for (let r = 0; r < rows; r++) {
            const off = r * dims;
            let s = 0;
            for (let i = 0; i < dims; i++)
                s += matrix[off + i] * query[i];
            out[r] = s;
        }
        return out;
    }
    matrixUpsert(row, vector) {
        if (this.available && this.mmap) {
            try {
                this.mmap.upsert(row, vector);
                return row + 1;
            }
            catch {
                /* fall through to JS */
            }
        }
        if (!this.jsMatrix || this.jsMatrixDims !== vector.length || row + 1 > this.jsMatrixRows) {
            const rows = Math.max(1024, row + 1);
            const next = new Float32Array(rows * vector.length);
            if (this.jsMatrix)
                next.set(this.jsMatrix.subarray(0, this.jsMatrixRows * this.jsMatrixDims));
            this.jsMatrix = next;
            this.jsMatrixDims = vector.length;
            this.jsMatrixRows = rows;
        }
        this.jsMatrix.set(vector, row * this.jsMatrixDims);
        return this.jsMatrixRows;
    }
    ringPush(value) {
        if (this.available && this.ring) {
            try {
                return this.ring.push(value);
            }
            catch {
                /* fall through */
            }
        }
        if (this.jsRing.length >= this.jsRingCap)
            return false;
        this.jsRing.push(value);
        return true;
    }
    ringPop() {
        if (this.available && this.ring) {
            try {
                return this.ring.pop();
            }
            catch {
                /* fall through */
            }
        }
        return this.jsRing.length > 0 ? this.jsRing.shift() : null;
    }
    ringLen() {
        if (this.available && this.ring) {
            try {
                return this.ring.len();
            }
            catch {
                /* fall through */
            }
        }
        return this.jsRing.length;
    }
}
/** Canonical acceleration surface used by the brain layers. */
exports.kernelAccel = new KernelAccelImpl();
exports.default = KernelBridge;
