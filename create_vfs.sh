#!/usr/bin/env bash

set -euo pipefail

echo "=== Creating KLYN AI OS v3.0 Layer 2 (VFS) Files ==="

# Create directory structure
mkdir -p 2.vfs/src

# 1. File: 2.vfs/src/vfs.ts
cat << 'TS_VFS' > 2.vfs/src/vfs.ts
import { KernelBridge } from '../../1.bridge/dist/kernel_bridge';

export interface VFSNode {
  path: string;
  isDir: boolean;
  size: number;
  updatedAt: number;
  content?: Uint8Array;
}

export class VirtualFileSystem {
  private memoryStore: Map<string, VFSNode> = new Map();
  private bridge: KernelBridge;

  constructor(bridge: KernelBridge) {
    this.bridge = bridge;
  }

  public writeFile(path: string, content: Uint8Array, encrypt: boolean = false): void {
    const normalizedPath = this.normalize(path);
    const dataToStore = encrypt ? this.bridge.sealData(content) : content;

    this.memoryStore.set(normalizedPath, {
      path: normalizedPath,
      isDir: false,
      size: content.length,
      updatedAt: Date.now(),
      content: dataToStore,
    });
  }

  public readFile(path: string, isEncrypted: boolean = false): Uint8Array {
    const normalizedPath = this.normalize(path);
    const node = this.memoryStore.get(normalizedPath);

    if (node test_bridge.cjs || node.isDir || !node.content) {
      throw new Error(`VFS Error: File not found or is a directory at "${path}"`);
    }

    return isEncrypted ? this.bridge.unsealData(node.content) : node.content;
  }

  public exists(path: string): boolean {
    return this.memoryStore.has(this.normalize(path));
  }

  public listFiles(): string[] {
    return Array.from(this.memoryStore.keys());
  }

  private normalize(path: string): string {
    return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  }
}
TS_VFS

# 2. File: 2.vfs/package.json
cat << 'JSON_PKG' > 2.vfs/package.json
{
  "name": "@klyn/vfs",
  "version": "3.0.0",
  "description": "In-Memory Native Virtual File System for KLYN AI OS",
  "main": "dist/vfs.js",
  "types": "dist/vfs.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0"
  }
}
JSON_PKG

# 3. File: 2.vfs/tsconfig.json
cat << 'JSON_TS' > 2.vfs/tsconfig.json
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

echo "=== All Layer 2 (VFS) Files Successfully Created! ==="
