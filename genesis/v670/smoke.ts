/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Runtime Smoke Test
 * File: genesis/v670/smoke.ts
 * Run:   bun run genesis/v670/smoke.ts   (or `bun smoke:v670`)
 *
 * Boots the omniversal kernel in embedded mode and verifies every plane:
 *   memory, fabric, capabilities, reality, intelligence, simulator,
 *   UDS round-trip latency, ring buffer, orchestrator ticks, cross-reality.
 * =============================================================================
 */

import { KlynOmniversalKernel } from './components/KlynOmniversalKernel.js';
import { UdsClient } from './ipc/uds-client.js';
import { RingBuffer } from './ipc/ring-buffer.js';
import { V670_OP } from './ipc/protocol.js';
import type { V670Config } from './types.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log('=== KLYN Genesis V670 Omniversal Runtime — Smoke Test ===\n');

  const config: Partial<V670Config> = {
    kernelId: 'v670-smoke',
    enableIpc: true,
    ipcSocketPath: null,
    tickMs: 100,
    workingDirectory: process.cwd(),
    native: false,
    brainMode: 'embedded',
    persistDir: null,
    pluginsDir: null,
  };

  const kernel = new KlynOmniversalKernel({ config });
  await kernel.boot();

  // 1. All modules running ---------------------------------------------------
  const health = kernel.health();
  check(
    'all modules running',
    health.status === 'booted' && health.modules.every((m) => m.status === 'running'),
    health.modules.map((m) => `${m.id}:${m.status}`).join(', ')
  );

  // 2. Memory plane ----------------------------------------------------------
  await kernel.memory.store('smoke:greeting', { text: 'hello v670' }, { tags: ['smoke'] });
  const greeting = await kernel.memory.retrieve('smoke:greeting');
  check('memory store/retrieve', JSON.stringify(greeting) === JSON.stringify({ text: 'hello v670' }));

  await kernel.memory.store('smoke:error', { text: 'kernel panic on hot swap' }, { tags: ['smoke'] });
  const hits = await kernel.memory.search('kernel panic', 2);
  check('memory semantic search', hits.length >= 1 && hits[0].score > 0, JSON.stringify(hits));

  // 3. Execution fabric ------------------------------------------------------
  // NOTE: ProcessExecutor uses spawn(..., { shell: true }), so the whole
  // command must be a single string — args are re-joined unquoted.
  const exec = await kernel.fabric.executeCommand('node -e "process.stdout.write(\'v670-ok\')"');
  check(
    'fabric command execution',
    exec.success && exec.stdout.includes('v670-ok'),
    `exit=${exec.exitCode} stdout=${exec.stdout.trim()}`
  );

  // 4. Capability plane ------------------------------------------------------
  kernel.capabilities.registerCapability({
    id: 'sim.exec',
    name: 'Simulation Executor',
    version: '1.0.0',
    description: 'Runs simulation workloads',
    permissions: ['sim.run'],
    enabled: true,
  });
  check('capability register+acquire', kernel.capabilities.acquire('sim.exec', ['sim.run']));
  check('capability policy denial', !kernel.capabilities.acquire('sim.exec', ['network.egress-arbitrary']));

  // 5. Reality plane ---------------------------------------------------------
  kernel.reality.registerEntity({ id: 'src/main.ts', type: 'file', name: 'main.ts', path: 'src/main.ts' });
  kernel.reality.addRelation({ source: 'src/main.ts', target: 'src/engine', type: 'imports' });
  const snapshot = kernel.reality.observe();
  check(
    'reality observe',
    snapshot.entities >= 1 && snapshot.relations >= 1,
    `entities=${snapshot.entities} relations=${snapshot.relations} health=${snapshot.health}`
  );

  // 6. Simulation plane ------------------------------------------------------
  const forecast = kernel.simulator.forecast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { horizon: 5 });
  check(
    'simulator forecast',
    forecast.series.length === 5 && forecast.trend === 'up',
    `trend=${forecast.trend} next=${forecast.nextValue} model=${forecast.model}`
  );

  kernel.simulator.seedGraph([
    { source: 'a', target: 'b', type: 'imports' },
    { source: 'b', target: 'c', type: 'imports' },
  ]);
  // Changing 'c' impacts every node that (transitively) depends on it.
  const impact = kernel.simulator.impact('c');
  check('impact simulation', impact.affectedNodes.length >= 2, `affected=${impact.affectedNodes.length} severity=${impact.severity}`);

  // 7. UDS round-trip --------------------------------------------------------
  const udsStats = kernel.runtime.getUdsServer()?.getStats();
  if (udsStats?.socketPath) {
    const client = new UdsClient(udsStats.socketPath);
    await client.connect();
    const reply = await client.request(V670_OP.PING, { t: Date.now() });
    const latency = client.getLatency();
    check('UDS round-trip', reply !== undefined, `p50=${latency.p50.toFixed(3)}ms p99=${latency.p99.toFixed(3)}ms`);
    client.close();
  } else {
    check('UDS round-trip', false, 'server unavailable');
  }

  // 8. Ring buffer (SPSC) ----------------------------------------------------
  const ring = new RingBuffer<number>({ capacity: 4 });
  ring.push(1);
  ring.push(2);
  ring.push(3);
  ring.push(4);
  const dropped = !ring.push(5);
  check('ring buffer capacity', dropped && ring.depth === 4, `depth=${ring.depth} dropped=${dropped}`);
  check('ring buffer FIFO', ring.drain().join(',') === '1,2,3,4');

  // 9. Orchestrator loop -----------------------------------------------------
  await sleep(400);
  const ticks = kernel.orchestrator.getStats().ticks;
  check('orchestrator ticks', ticks >= 2, `ticks=${ticks}`);

  // 10. Cross-reality sync ---------------------------------------------------
  await kernel.crossReality.sync();
  const crossStats = kernel.crossReality.getStats();
  check('cross-reality sync', crossStats.syncCount >= 1, `files=${crossStats.fileEntries} journal=${crossStats.journalSize}`);

  // 11. Orchestrated dispatch via ring → fabric ------------------------------
  kernel.runtime.dispatch('execute', { command: 'node -e "process.stdout.write(\'ring-ok\')"' });
  await sleep(300);
  const orchestratorStats = kernel.orchestrator.getStats();
  check('ring → orchestrator dispatch', orchestratorStats.dispatched >= 1, `dispatched=${orchestratorStats.dispatched}`);

  // Shutdown -----------------------------------------------------------------
  await kernel.shutdown();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== V670 SMOKE SUMMARY: ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('V670 smoke test crashed:', err);
  process.exit(1);
});
