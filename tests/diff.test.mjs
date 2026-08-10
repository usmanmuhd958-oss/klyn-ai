// KLYN AI OS — Regression suite for the patch/diff engine (audit fix #1).
// The previous LCS implementation was O(m*n) time AND memory; the new Myers
// engine must be optimal on small inputs, correct on pathological ones, and
// fast on whole-file LLM rewrites.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PatchGenerator } from '../dist/1.brain/patch_generator.js';

const pg = new PatchGenerator();

/** Apply a DiffLine[] script; returns reconstructed new lines + edit count. */
function applyScript(a, script) {
  const out = [];
  let ai = 0;
  let edits = 0;
  for (const s of script) {
    if (s.type === 'context') {
      out.push(s.content);
      ai++;
    } else if (s.type === 'delete') {
      edits++;
      ai++;
    } else {
      out.push(s.content);
      edits++;
    }
  }
  return { out, edits };
}

/** LCS-based optimal edit distance (delete+insert only — no substitution op). */
function optimalDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return m + n - 2 * prev[n];
}

function check(a, b, label, requireOptimal = true) {
  const script = pg.computeDiffForTest ? pg.computeDiffForTest(a, b) : pg['computeDiff'](a, b);
  const { out, edits } = applyScript(a, script);
  assert.deepEqual(out, b, `reconstruction failed: ${label}`);
  if (requireOptimal) {
    assert.equal(edits, optimalDistance(a, b), `non-optimal diff: ${label}`);
  }
  return script;
}

describe('patch_generator diff engine', () => {
  test('edge cases', () => {
    check([], [], 'empty/empty');
    check(['a'], [], 'a/empty');
    check([], ['a'], 'empty/a');
    check(['a'], ['a'], 'identical');
    check(['a', 'b', 'c'], ['a', 'x', 'c'], 'middle replace');
    check(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'], 'append');
    check(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c'], 'truncate');
    check(['a', 'b'], ['b', 'a'], 'swap');
    check(['a', 'b', 'c', 'd'], ['c', 'd', 'a', 'b'], 'rotate');
    check(['x', 'a', 'a', 'a', 'y'], ['x', 'a', 'a', 'y'], 'dup delete');
    check(['a'], ['a', 'a'], 'duplicate');
  });

  test('randomized small cases are optimal (300 cases)', () => {
    const alph = ['α', 'β', 'γ', 'δ', 'ε'];
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 300; t++) {
      const a = [];
      for (let i = 0, n = Math.floor(rng() * 12); i < n; i++) a.push(alph[Math.floor(rng() * 5)] + i);
      const b = [];
      for (let i = 0, n = Math.floor(rng() * 12); i < n; i++) b.push(alph[Math.floor(rng() * 5)] + i);
      check(a, b, `rand#${t}`);
    }
  });

  test('whole-file rewrite (5k lines) completes quickly', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `old_${i}`);
    const b = Array.from({ length: 5000 }, (_, i) => `new_${i}`);
    const t0 = performance.now();
    const script = pg['computeDiff'](a, b);
    const dt = performance.now() - t0;
    const { out } = applyScript(a, script);
    assert.deepEqual(out, b);
    assert.ok(dt < 5000, `diff took ${dt.toFixed(0)}ms (regression)`);
  });

  test('50k-line file with single edit stays fast', () => {
    const big = Array.from({ length: 50000 }, (_, i) => `line_${i}`);
    const big2 = big.slice();
    big2[25000] = 'line_EDITED';
    const t0 = performance.now();
    pg['computeDiff'](big, big2);
    const dt = performance.now() - t0;
    assert.ok(dt < 5000, `diff took ${dt.toFixed(0)}ms (regression)`);
  });

  test('anchor fallback handles two fully-different 12k-line files', () => {
    const a = Array.from({ length: 12000 }, (_, i) => `A${i}`);
    const b = Array.from({ length: 12000 }, (_, i) => `B${i}`);
    const t0 = performance.now();
    const script = pg['computeDiff'](a, b);
    const dt = performance.now() - t0;
    const { out } = applyScript(a, script);
    assert.deepEqual(out, b);
    assert.ok(dt < 5000, `anchor diff took ${dt.toFixed(0)}ms (regression)`);
  });

  test('generateUnifiedDiff + formatUnifiedDiff keep working', () => {
    const diff = pg.generateUnifiedDiff('test.ts', 'a\nb\nc\nd\ne\n', 'a\nb\nCHANGED\nd\ne\nf\n');
    assert.equal(diff.hunks.length, 1);
    assert.equal(diff.originalHash.length, 64);
    assert.equal(diff.newHash.length, 64);
    const formatted = pg.formatUnifiedDiff(diff);
    assert.match(formatted, /^--- a\/test\.ts/m);
    assert.match(formatted, /^@@ /m);
    assert.match(formatted, /^\+CHANGED$/m);
  });
});
