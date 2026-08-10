// KLYN AI OS — Regression suite for the vector vault (audit fix #2).
// Verifies persistence across re-initialization (state hydration), top-K
// ordering, threshold filtering, prefix removal and namespace isolation.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeVault,
  storeMemory,
  recall,
  queryMemory,
  removeMemoryPrefix,
  memoryCount,
} from '../index.js';

let dir;

function emb(seed) {
  // Category-vector embeddings: index parity groups seeds into 3 categories,
  // so same-category seeds are highly similar and cross-category ~orthogonal
  // (deterministic, avoids accidental negative similarities).
  const a = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    a[i] = (i % 3 === seed % 3 ? 1 : 0) + (i + 1) * seed * 1e-6;
  }
  let n = 0;
  for (const v of a) n += v * v;
  n = Math.sqrt(n);
  for (let i = 0; i < 16; i++) a[i] /= n;
  return a;
}

describe('vector vault', () => {
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klyn-vault-test-'));
    initializeVault(dir);
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('store/recall with namespace filtering and ordering', async () => {
    storeMemory('a', 'ns1', emb(1), Buffer.from(JSON.stringify({ file: 'a.ts' })), ['a']);
    storeMemory('b', 'ns1', emb(2), Buffer.from(JSON.stringify({ file: 'b.ts' })), ['b']);
    storeMemory('c', 'ns2', emb(3), Buffer.from(JSON.stringify({ file: 'c.ts' })), ['c']);
    await new Promise((r) => setTimeout(r, 150)); // let debounced flush land

    const res = recall(emb(1), 'ns1', 2, 0);
    assert.equal(res[0].id, 'a');
    assert.equal(res[0].payload.toString('utf8'), JSON.stringify({ file: 'a.ts' }));
    assert.ok(res[0].score >= res[1].score);
  });

  test('state hydrates from disk after re-initialization', async () => {
    initializeVault(dir);
    assert.equal(memoryCount(), 3);
    const res = recall(emb(2), 'ns1', 1, 0);
    assert.equal(res[0].id, 'b');
    assert.equal(res[0].payload.toString('utf8'), JSON.stringify({ file: 'b.ts' }));
  });

  test('queryMemory performs real similarity search', () => {
    const q = queryMemory('ns1', emb(3), 2);
    assert.equal(q.length, 2);
    assert.ok(q.every((r) => r.namespace === 'ns1'));
  });

  test('threshold filters low-similarity entries', () => {
    // seed 6 => category 0, which no ns1 entry uses: all sims ~0 < 0.99.
    const res = recall(emb(6), 'ns1', 5, 0.99);
    assert.equal(res.length, 0);
  });

  test('removeMemoryPrefix drops stale blocks and persists the removal', async () => {
    removeMemoryPrefix('a');
    assert.equal(memoryCount(), 2);
    initializeVault(dir); // re-hydrate from the compacted file
    assert.equal(memoryCount(), 2);
    assert.equal(recall(emb(1), 'ns1', 1, 0)[0].id, 'b');
  });

  test('top-K is bounded and sorted', async () => {
    for (let i = 0; i < 500; i++) storeMemory('x' + i, 'big', emb(i), Buffer.from('p' + i), []);
    await new Promise((r) => setTimeout(r, 200));
    const res = recall(emb(100), 'big', 10, 0);
    assert.equal(res.length, 10);
    for (let i = 1; i < res.length; i++) {
      assert.ok(res[i - 1].similarity >= res[i].similarity);
      assert.ok(Number.isFinite(res[i].similarity));
    }
  });

  test('degenerate (zero/NaN) embeddings are rejected, not stored', async () => {
    const zero = new Float32Array(16);
    storeMemory('bad-zero', 'ns1', zero, Buffer.from('x'), []);
    const nan = new Float32Array(16).fill(NaN);
    storeMemory('bad-nan', 'ns1', nan, Buffer.from('x'), []);
    await new Promise((r) => setTimeout(r, 150));
    const res = recall(emb(1), 'ns1', 20, 0);
    assert.ok(!res.some((r) => r.id === 'bad-zero' || r.id === 'bad-nan'));
  });
});
