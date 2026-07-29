// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// src/core/hash.ts
import { createHash } from 'node:crypto';

export class HashEngine {
  private static readonly HASH_ALGO = 'sha256';
  
  static hash(data: Uint8Array | string): string {
    const buffer = typeof data === 'string' 
      ? Buffer.from(data, 'utf-8') 
      : Buffer.from(data);
    return createHash(this.HASH_ALGO).update(buffer).digest('hex');
  }
  
  static hashCombine(hashes: string[]): string {
    return this.hash(hashes.join(''));
  }
  
  static contentHash(content: string, links: string[]): string {
    return this.hash(content + links.sort().join(''));
  }
}
