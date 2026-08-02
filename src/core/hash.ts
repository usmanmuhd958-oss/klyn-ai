// src/core/hash.ts
import { createHash } from 'node:crypto';

export class HashEngine {
  private static readonly HASH_ALGO = 'sha256';
  
  static hash(data: Uint8Array | string): string {
    const buffer = typeof data === 'string' 
      ? Buffer.from(data, 'utf-8') 
      : data;
    return createHash(this.HASH_ALGO).update(buffer).digest('hex');
  }
  
  static hashCombine(hashes: string[]): string {
    return this.hash(hashes.join(''));
  }
  
  static contentHash(content: Uint8Array | string, links: string[]): string {
    const linkStr = links.sort().join(',');
    if (typeof content === 'string') {
      return this.hash(content + linkStr);
    }
    const combined = Buffer.concat([
      content,
      Buffer.from(linkStr, 'utf-8'),
    ]);
    return this.hash(combined);
  }
}
