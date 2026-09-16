import { join } from 'path';
import { randomBytes } from 'crypto';

export interface KernelStats {
  ruleCount: number;
  secretCount: number;
}

export interface NativeKernelHandle {
  addRule?(ruleJson: string): boolean;
  evaluateRules?(contextJson: string): string;
  getSecret?(key: string): number[] | null;
  getStats?(): KernelStats;
  removeRule?(ruleId: string): boolean;
  sendEvent?(eventName: string, payloadJson: string): boolean;
  setSecret?(key: string, value: number[]): void;
  [key: string]: unknown;
}

interface NativeModule {
  KernelHandle: new (key: number[]) => NativeKernelHandle;
}

function loadNativeKernel(): NativeModule {
  const binaryName = `klyn_kernel_core.${process.platform}-${process.arch}.node`;
  const primaryPath = join(__dirname, binaryName);
  const fallbackPath = join(__dirname, 'klyn_kernel_core.android-arm64.node');

  try {
    return require(primaryPath) as NativeModule;
  } catch {
    try {
      return require(fallbackPath) as NativeModule;
    } catch (error) {
      throw new Error(
        `[Klyn AI OS Engine] Native kernel binding failed to load: ${(error as Error).message}`
      );
    }
  }
}

export class KlynKernelEngine {
  private nativeHandle: NativeKernelHandle;
  private initializedAt: Date;

  constructor(key?: Uint8Array | Buffer | number[]) {
    const { KernelHandle } = loadNativeKernel();
    
    let keyArray: number[];

    if (!key) {
      keyArray = Array.from(randomBytes(32));
    } else if (Array.isArray(key)) {
      keyArray = key;
    } else {
      keyArray = Array.from(key);
    }

    if (keyArray.length !== 32) {
      throw new Error('[Klyn AI OS Engine] Kernel key must be exactly 32 bytes (AES-256)');
    }

    this.nativeHandle = new KernelHandle(keyArray);
    this.initializedAt = new Date();
  }

  public getEngineStatus() {
    return {
      status: 'active',
      platform: `${process.platform}-${process.arch}`,
      initializedAt: this.initializedAt.toISOString(),
      nativeLoaded: true,
    };
  }

  public getStats(): KernelStats | null {
    if (typeof this.nativeHandle.getStats === 'function') {
      return this.nativeHandle.getStats();
    }
    return null;
  }

  /**
   * Encrypts and stores a secret in the Rust encrypted vault
   * @param key Secret lookup identifier string
   * @param value Plaintext value to encrypt
   */
  public setSecret(key: string, value: string | Buffer | Uint8Array): void {
    if (typeof this.nativeHandle.setSecret === 'function') {
      const valBytes = typeof value === 'string' 
        ? Array.from(Buffer.from(value, 'utf8')) 
        : Array.from(value);
      this.nativeHandle.setSecret(key, valBytes);
    }
  }

  /**
   * Decrypts and retrieves a secret from the Rust encrypted vault
   * @param key Secret lookup identifier string
   */
  public getSecret(key: string): string | null {
    if (typeof this.nativeHandle.getSecret === 'function') {
      const res = this.nativeHandle.getSecret(key);
      if (res && Array.isArray(res)) {
        return Buffer.from(res).toString('utf8');
      }
    }
    return null;
  }

  public getRawHandle(): NativeKernelHandle {
    return this.nativeHandle;
  }
}

export default KlynKernelEngine;
