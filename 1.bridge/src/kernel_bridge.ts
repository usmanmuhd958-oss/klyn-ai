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
