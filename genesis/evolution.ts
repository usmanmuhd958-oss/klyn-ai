/**
 * =============================================================================
 * KLYN AI OS — GENESIS EVOLUTION RUNNER
 * File: genesis/evolution.ts
 *
 * Boots and self-tests every evolution layer (V671–V700) by running each
 * layer's smoke.ts in a subprocess, then aggregates the result.
 *
 *   Run:   bun run genesis/evolution.ts        (or: npm run genesis:test)
 *
 * Runner selection: bun if available, otherwise node >= 23 with
 * --experimental-strip-types.
 * =============================================================================
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface EvolutionLayer {
  id: string;
  name: string;
  codename: string;
  mission: string;
  dependsOn: string[];
  modules: string[];
  contracts: string[];
  policies: Record<string, number>;
  commitMessage: string;
}

const GENESIS_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = join(GENESIS_DIR, 'evolution-manifest.json');
const manifest: EvolutionLayer[] = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

function detectRunner(): { bin: string; args: string[] } {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return { bin: 'bun', args: ['run'] };
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  if (major >= 23) return { bin: 'node', args: ['--experimental-strip-types'] };
  throw new Error('evolution runner requires bun (or node >= 23 with --experimental-strip-types)');
}

const { bin, args } = detectRunner();

let passed = 0;
let failed = 0;
const failures: string[] = [];

console.log('GENESIS EVOLUTION — V671..V700 self-test (' + manifest.length + ' layers)');
console.log('runner: ' + bin + ' ' + args.join(' '));
console.log('');

for (const layer of manifest) {
  const smokePath = join(GENESIS_DIR, layer.id, 'smoke.ts');
  if (!existsSync(smokePath)) {
    failed += 1;
    failures.push(layer.id + ': missing smoke.ts (run: node genesis/forge.mjs all)');
    console.log('FAIL  ' + layer.id + '  missing smoke.ts');
    continue;
  }
  const result = spawnSync(bin, [...args, smokePath], { encoding: 'utf8' });
  const lines = (result.stdout ?? '').trim().split('\n');
  const tail = lines[lines.length - 1] ?? '(no output)';
  if (result.status === 0) {
    passed += 1;
    console.log('PASS  ' + layer.id + '  ' + tail);
  } else {
    failed += 1;
    failures.push(layer.id + ': ' + tail);
    console.log('FAIL  ' + layer.id + '  ' + tail);
    const stderrTail = (result.stderr ?? '').trim().split('\n').slice(-3).join(' | ');
    if (stderrTail) console.log('      stderr: ' + stderrTail);
  }
}

console.log('');
console.log('=== EVOLUTION V671-V700: ' + passed + '/' + (passed + failed) + ' layers passed ===');
if (failed > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log('  - ' + failure);
  process.exitCode = 1;
}
