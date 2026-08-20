import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { HashEngine } from '../../src/core/hash.js';

const sha256 = (value: string): string =>
  createHash('sha256').update(Buffer.from(value, 'utf-8')).digest('hex');

describe('HashEngine.hash', () => {
  it('produces the sha256 hex digest of a string', () => {
    expect(HashEngine.hash('klyn')).toBe(sha256('klyn'));
  });

  it('is deterministic for repeated calls', () => {
    expect(HashEngine.hash('abc')).toBe(HashEngine.hash('abc'));
  });

  it('treats a Uint8Array and its utf-8 string form identically', () => {
    const text = 'kernel payload';
    expect(HashEngine.hash(new TextEncoder().encode(text))).toBe(HashEngine.hash(text));
  });

  it('produces different digests for different content', () => {
    expect(HashEngine.hash('a')).not.toBe(HashEngine.hash('b'));
  });

  it('hashes empty input', () => {
    expect(HashEngine.hash('')).toBe(sha256(''));
  });
});

describe('HashEngine.hashCombine', () => {
  it('hashes the concatenation of the given hashes', () => {
    expect(HashEngine.hashCombine(['a', 'b', 'c'])).toBe(sha256('abc'));
  });

  it('is order sensitive', () => {
    expect(HashEngine.hashCombine(['a', 'b'])).not.toBe(HashEngine.hashCombine(['b', 'a']));
  });

  it('hashes an empty list as empty input', () => {
    expect(HashEngine.hashCombine([])).toBe(sha256(''));
  });
});

describe('HashEngine.contentHash', () => {
  it('is invariant to link ordering', () => {
    expect(HashEngine.contentHash('body', ['b', 'a'])).toBe(
      HashEngine.contentHash('body', ['a', 'b'])
    );
  });

  it('changes when content changes', () => {
    expect(HashEngine.contentHash('body', ['a'])).not.toBe(
      HashEngine.contentHash('other', ['a'])
    );
  });

  it('changes when links change', () => {
    expect(HashEngine.contentHash('body', ['a'])).not.toBe(
      HashEngine.contentHash('body', ['a', 'b'])
    );
  });

  it('matches the sha256 of content followed by sorted links', () => {
    expect(HashEngine.contentHash('body', ['b', 'a'])).toBe(sha256('bodyab'));
  });
});
