#!/usr/bin/env bash

set -euo pipefail

echo "=== Creating KLYN AI OS v3.0 Bridge Layer Files ==="

# Create directory structure
mkdir -p 1.bridge/src

# 1. File: 1.bridge/src/kernel_bridge.ts
cat << 'TS_BRIDGE' > 1.bridge/src/kernel_bridge.ts
import { existsSync } from 'fs';
import { join } from 'path';

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
      const addon = require(addonPath);
      this.nativeKernel = new addon.KlynKernel();
      this.isInitialized = true;
    } catch (err) {
      throw new Error(`Failed to load KLYN Native Kernel bindings: ${err}`);
    }
  }

  public submitEvent(payload: KernelEventPayload): number {
    this.assertActive();
    // Fast path: Serialize payload into zero-copy binary layout
    const headerSize = 24; // 8 (id) + 8 (timestamp) + 4 (type) + 1 (priority) + 1 (flags) + 2 (offset)
    const totalSize = headerSize + payload.data.length;
    const buf = Buffer.allocUnsafe(totalSize);

    buf.writeBigUInt64LE(0n, 0); // Event ID assigned by Rust
    buf.writeBigUInt64LE(BigInt(Date.now()), 8);
    buf.writeUInt32LE(payload.eventType, 16);
    buf.writeUInt8(0, 20); // Priority
    buf.writeUInt8(0, 21); // Flags
    buf.writeUInt16LE(headerSize, 22); // Data offset

    Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength).copy(buf, headerSize);

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
TS_BRIDGE

# 2. File: 1.bridge/package.json
cat << 'JSON_PKG' > 1.bridge/package.json
{
  "name": "@klyn/bridge",
  "version": "3.0.0",
  "description": "TypeScript Bridge to KLYN AI OS Native Rust Kernel Layer",
  "main": "dist/kernel_bridge.js",
  "types": "dist/kernel_bridge.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "node --test"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
JSON_PKG

# 3. File: 1.bridge/tsconfig.json
cat << 'JSON_TS' > 1.bridge/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
JSON_TS

echo "=== All Bridge Layer Files Successfully Created! ==="
