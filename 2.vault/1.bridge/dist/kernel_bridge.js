"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KernelBridge = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
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
