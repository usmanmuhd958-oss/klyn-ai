// src/core/hash.ts
import { createHash } from 'node:crypto';
export class HashEngine {
    static HASH_ALGO = 'sha256';
    static hash(data) {
        const buffer = typeof data === 'string'
            ? Buffer.from(data, 'utf-8')
            : Buffer.from(data);
        return createHash(this.HASH_ALGO).update(buffer).digest('hex');
    }
    static hashCombine(hashes) {
        return this.hash(hashes.join(''));
    }
    static contentHash(content, links) {
        return this.hash(content + links.sort().join(''));
    }
}
