// src/indexer/file_scanner.ts
import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeMetadata } from '../types/core.js';

export interface ScanOptions {
  ignore?: string[];
  maxDepth?: number;
  maxFileSize?: number;
  poolSize?: number;
}

export class FileScanner {
  private static readonly DEFAULT_IGNORE = [
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.next', '.cache', 'out', 'target', '__pycache__', '.venv', 'venv'
  ];

  private static readonly POOL_SIZE = 8;

  static async *scan(
    rootPath: string,
    options: ScanOptions = {}
  ): AsyncGenerator<{ path: string; content: Uint8Array; metadata: NodeMetadata }> {
    const {
      ignore = this.DEFAULT_IGNORE,
      maxDepth = 20,
      maxFileSize = 5 * 1024 * 1024,
      poolSize = this.POOL_SIZE,
    } = options;

    const ignoreSet = new Set(ignore);
    const bufferPool: Uint8Array[] = [];
    const poolSizeBytes = Math.min(maxFileSize, 2 * 1024 * 1024);

    for (let i = 0; i < poolSize; i++) {
      bufferPool.push(new Uint8Array(poolSizeBytes));
    }

    let poolIndex = 0;

    async function* walk(dir: string, depth: number): AsyncGenerator<{ path: string; content: Uint8Array; metadata: NodeMetadata }> {
      if (depth > maxDepth) return;

      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoreSet.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        const stats = await stat(fullPath);

        if (entry.isDirectory()) {
          yield* walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (stats.size > maxFileSize || stats.size === 0) continue;

          const buffer = bufferPool[poolIndex % poolSize];
          poolIndex++;

          let fileHandle;
          try {
            fileHandle = await open(fullPath, 'r');
            const { bytesRead } = await fileHandle.read(buffer, 0, Math.min(stats.size, buffer.length), 0);
            
            const metadata: NodeMetadata = {
              path: fullPath,
              size: stats.size,
              mtime: stats.mtimeMs,
              type: 'file',
            };
            
            yield { path: fullPath, content: buffer.subarray(0, bytesRead), metadata };
          } finally {
            if (fileHandle) await fileHandle.close();
          }
        }
      }
    }

    yield* walk(rootPath, 0);
  }
}
