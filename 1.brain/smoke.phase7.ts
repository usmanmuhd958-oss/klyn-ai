// =============================================================================
// KLYN AI OS — Phase 7 Smoke Test
// File: 1.brain/smoke.phase7.ts
//
// Run:  bun run smoke:phase7   (or: bun run 1.brain/smoke.phase7.ts)
//
// Covers all four Phase 7 capabilities:
//   1. Operational Experience Learner (bounded, deterministic aggregates)
//   2. Adaptive Policy Engine (Merkle-signed, regression-guarded rollback)
//   3. Self-Healing Fleet Orchestrator (liveness, quarantine, rebalance)
//   4. Autonomous Self-Evolution Loop (closed loop: sense → learn → evolve)
// =============================================================================
import { EventBus } from '../packages/core-runtime/src/EventBus.js';
import { ExperienceLearner } from './experience_learner.js';
import { AdaptivePolicyEngine, sanitizeRules, DEFAULT_POLICY_RULES } from './adaptive_policy.js';
import { FleetOrchestrator } from '../packages/swarm-mesh/src/fleet_orchestrator.js';
import { EvolutionLoop } from './evolution_loop.js';
import { P2PNode, InMemoryTransport } from '../packages/swarm-mesh/src/p2p_node.js';

let failures = 0;
let passes = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passes++;
    console.log(`PASS  ${name}${detail ? `  → ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) OPERATIONAL EXPERIENCE LEARNER
// ─────────────────────────────────────────────────────────────────────────────
function learnerSuite(): void {
  const learner = new ExperienceLearner();
  learner.record('patch', 'src/a.ts', true, 10);
  learner.record('patch', 'src/a.ts', false, 30);
  learner.record('patch', 'src/b.ts', true, 20);

  const perKey = learner.query('patch', 'src/a.ts');
  check('learner: per-key aggregates correct', perKey?.samples === 2 && perKey.successRate === 0.5 && perKey.avgLatencyMs === 20, JSON.stringify(perKey));

  const merged = learner.query('patch');
  check('learner: merged scope aggregates', merged?.samples === 3 && merged.successes === 2 && merged.successRate === 2 / 3, JSON.stringify(merged));

  check('learner: unknown scope returns null', learner.query('nope') === null);

  check('learner: confidence scales with samples', (learner.query('patch', 'src/a.ts')?.confidence ?? 0) === 0.04, `conf=${learner.query('patch', 'src/a.ts')?.confidence}`);

  // Ring buffer bound: oldest experiences evicted first.
  const small = new ExperienceLearner({ maxExperiences: 5 });
  for (let i = 0; i < 10; i++) small.record('patch', 'k', true, 1, `e${i}`);
  const kept = small.recent(100);
  check('learner: ring buffer bounded (oldest evicted)', kept.length === 5 && kept[0].detail === 'e5', `kept=${kept.length}, first=${kept[0]?.detail}`);

  // Key-table bound: LRU key evicted.
  const tiny = new ExperienceLearner({ maxKeys: 3 });
  tiny.record('patch', 'k1', true);
  tiny.record('patch', 'k2', true);
  tiny.record('patch', 'k3', true);
  tiny.record('patch', 'k4', true);
  check('learner: key table bounded (LRU evicted)', tiny.summarize().keys === 3 && tiny.query('patch', 'k1') === null && tiny.query('patch', 'k4') !== null, `keys=${tiny.summarize().keys}`);

  // EventBus subscription: any producer's 'experience' events are recorded.
  const bus = new EventBus();
  const subscribed = new ExperienceLearner({ bus });
  bus.publish({ type: 'experience', payload: { scope: 'fuzz', key: 'endpoint-a', success: false, latencyMs: 5 }, timestamp: Date.now() });
  const fuzzStats = subscribed.query('fuzz', 'endpoint-a');
  check('learner: records bus experience events', fuzzStats?.samples === 1 && fuzzStats.failures === 1, JSON.stringify(fuzzStats));

  // Determinism: identical streams → identical aggregates.
  const l1 = new ExperienceLearner();
  const l2 = new ExperienceLearner();
  for (let i = 0; i < 20; i++) {
    l1.record('route', `r${i % 3}`, i % 4 !== 0, i);
    l2.record('route', `r${i % 3}`, i % 4 !== 0, i);
  }
  check('learner: deterministic across identical streams', JSON.stringify(l1.query('route')) === JSON.stringify(l2.query('route')) && JSON.stringify(l1.summarize()) === JSON.stringify(l2.summarize()));

  // top(): worst keys by failure rate first.
  const ranked = new ExperienceLearner();
  ranked.record('patch', 'flaky', false);
  ranked.record('patch', 'flaky', false);
  ranked.record('patch', 'solid', true);
  const top = ranked.top('patch');
  check('learner: top() ranks worst keys first', top.length === 2 && top[0].key === 'flaky', top.map((t) => t.key).join(','));

  // reset().
  ranked.reset();
  check('learner: reset clears memory', ranked.summarize().experiences === 0 && ranked.query('patch') === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) ADAPTIVE POLICY ENGINE (Merkle-signed + regression-guarded)
// ─────────────────────────────────────────────────────────────────────────────
async function policySuite(): Promise<void> {
  const engine = new AdaptivePolicyEngine();
  check('policy: v0 baseline active', engine.activeVersion === 0 && engine.active.rules.qualityGateStrict === 0.5);
  check('policy: baseline ledger verifies', engine.verifyLedger());

  // Deterministic proposal from a failing-patch learner.
  const badLearner = new ExperienceLearner();
  for (let i = 0; i < 12; i++) badLearner.record('patch', 'src/x.ts', false);
  const draft = engine.proposeFromLearner(badLearner);
  check('policy: proposal tightens gate on failures', draft.rules.qualityGateStrict > 0.5 && draft.rules.maxRepairIterations < DEFAULT_POLICY_RULES.maxRepairIterations, `strict=${draft.rules.qualityGateStrict}, repairs=${draft.rules.maxRepairIterations}`);
  const draft2 = engine.proposeFromLearner(badLearner);
  check('policy: proposal deterministic', JSON.stringify(draft.rules) === JSON.stringify(draft2.rules) && JSON.stringify(draft.rationale) === JSON.stringify(draft2.rationale));

  // No-op and version-mismatch are rejected.
  const noEvidence = new ExperienceLearner();
  const noop = engine.proposeFromLearner(noEvidence);
  const noopResult = engine.activate(noop);
  check('policy: identical candidate rejected as no-op', noopResult.ok === false && String(noopResult.reason).includes('identical'), noopResult.reason);
  const badVersion = engine.activate({ ...draft, version: 99 });
  check('policy: version mismatch rejected', badVersion.ok === false && String(badVersion.reason).includes('version mismatch'), badVersion.reason);

  // Activation commits to the Merkle ledger and chains history.
  const activation = engine.activate(draft);
  check('policy: candidate activates', activation.ok && engine.activeVersion === 1, `v${engine.activeVersion}`);
  const history = engine.history();
  check('policy: history chains (prevRoot links)', history.length === 2 && history[1].prevRoot === history[0].root && history[1].root.length === 64);
  check('policy: ledger still verifies after activation', engine.verifyLedger());

  // Tamper detection: mutating committed rules breaks the audit.
  const tampered = { ...engine.active, rules: { ...engine.active.rules, qualityGateStrict: 0.99 } };
  const audit = engine.auditDraft(tampered);
  check('policy: tampered draft detected', audit.ok === false && audit.reasons.some((r) => r.includes('diverged')), audit.reasons.join(';'));
  check('policy: committed draft audits clean', engine.auditDraft(engine.active).ok === true);

  // Sanitization clamps garbage deterministically.
  const clean = sanitizeRules({ cascadeHeavyThreshold: 5, qualityGateStrict: -1, fuzzerIntervalMs: 100, maxRepairIterations: 0, retryBudget: 99, fleetLoadThreshold: 1 });
  check('policy: rules sanitized to legal ranges', clean.cascadeHeavyThreshold === 1 && clean.qualityGateStrict === 0 && clean.fuzzerIntervalMs === 5_000 && clean.maxRepairIterations === 1 && clean.retryBudget === 10 && clean.fleetLoadThreshold === 2, JSON.stringify(clean));

  // Regression guard: a candidate that degrades health rolls back.
  const guard = new AdaptivePolicyEngine({ windowSize: 4, tolerance: 0.15 });
  for (let i = 0; i < 4; i++) guard.observe(true, 10); // healthy baseline
  const guardProposal = guard.proposeFromLearner(badLearner);
  const guardActivation = guard.activate(guardProposal, { successRate: 1, avgLatencyMs: 10 });
  check('policy: guarded activation applied', guardActivation.ok && guard.activeVersion === 1);
  let outcome: ReturnType<AdaptivePolicyEngine['observe']> | null = null;
  for (let i = 0; i < 4; i++) outcome = guard.observe(false, 500); // catastrophic regime
  check(
    'policy: measured regression triggers deterministic rollback',
    outcome?.evaluated === true && outcome.rolledBack === true && guard.activeVersion === 0,
    `version=${guard.activeVersion}, rate=${outcome?.currentSuccessRate}`
  );
  check('policy: rollback recorded in the ledger', guard.verifyLedger() && guard.history().length === 2);

  // A candidate that HOLDS up stays.
  const stable = new AdaptivePolicyEngine({ windowSize: 4, tolerance: 0.15 });
  const stableProposal = stable.proposeFromLearner(badLearner);
  stable.activate(stableProposal);
  let stableOutcome: ReturnType<AdaptivePolicyEngine['observe']> | null = null;
  for (let i = 0; i < 4; i++) stableOutcome = stable.observe(true, 8);
  check('policy: stable candidate survives the window', stableOutcome?.evaluated === true && stableOutcome.stable === true && stable.activeVersion === 1, `version=${stable.activeVersion}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) SELF-HEALING FLEET ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────
async function fleetSuite(): Promise<void> {
  const bus = new EventBus();
  const events: string[] = [];
  bus.subscribe('fleet:quarantine', () => events.push('quarantine'));
  bus.subscribe('fleet:node_lost', () => events.push('lost'));
  bus.subscribe('fleet:recovered', () => events.push('recovered'));

  const repairs: string[] = [];
  const lost: string[] = [];
  const fleet = new FleetOrchestrator({
    bus,
    graceMs: 60,
    errorThreshold: 2,
    loadThreshold: 3,
    maxNodes: 3,
    onRepairNeeded: (nodeId, reason) => repairs.push(`${nodeId}:${reason}`),
    onNodeLost: (nodeId) => lost.push(nodeId),
  });

  check('fleet: nodes register', fleet.registerNode('node-a') && fleet.registerNode('node-b') && fleet.registerNode('node-c'));
  check('fleet: healthy initially', fleet.stats().healthy === 3, JSON.stringify(fleet.stats()));
  check('fleet: bounded table rejects overflow', fleet.registerNode('node-d') === false);

  // Error accounting → quarantine at threshold.
  fleet.reportError('node-a', 'validation crash');
  check('fleet: below error threshold not quarantined', fleet.quarantinedNodes().length === 0);
  fleet.reportError('node-a', 'validation crash again');
  check('fleet: error threshold quarantines + repair hook', fleet.quarantinedNodes().includes('node-a') && repairs.some((r) => r.startsWith('node-a:error threshold')), repairs.join(';'));

  const rebalance = fleet.rebalance();
  check('fleet: rebalance reroutes bad nodes to healthy targets', rebalance.rerouted.length === 1 && rebalance.rerouted[0].nodeId === 'node-a' && rebalance.targets.length === 2, JSON.stringify(rebalance));

  fleet.recover('node-a');
  check('fleet: recovery clears quarantine', fleet.quarantinedNodes().length === 0 && fleet.stats().healthy === 3);

  // Overload detection + auto-drain recovery.
  fleet.heartbeat('node-b', 5);
  check('fleet: overload quarantines', fleet.node('node-b')?.quarantined === true && fleet.node('node-b')?.quarantineReason?.startsWith('overload'), fleet.node('node-b')?.quarantineReason ?? '');
  fleet.heartbeat('node-b', 1);
  check('fleet: load drain auto-recovers', fleet.node('node-b')?.quarantined === false);

  // Death sweep: silence past grace → dead + events.
  fleet.heartbeat('node-c');
  await sleep(90);
  fleet.tick();
  check('fleet: silent node marked dead', fleet.deadNodes().includes('node-c') && events.includes('lost') && lost.includes('node-c'), JSON.stringify(fleet.stats()));

  // Heartbeat revives a dead node.
  fleet.heartbeat('node-c');
  check('fleet: heartbeat revives dead node', fleet.node('node-c')?.dead === false && events.includes('recovered'));

  // Free a slot (clean shutdown) so the real-node attach fits the cap.
  fleet.removeNode('node-c');

  // Attaching a real P2P node polls its pending load.
  const transport = new InMemoryTransport('mesh-a');
  const meshNode = new P2PNode(transport);
  check('fleet: attaches real mesh node', fleet.attach(meshNode));
  fleet.heartbeat('mesh-a');
  check('fleet: attached node healthy with polled load', fleet.node('mesh-a')?.load === 0 && fleet.node('mesh-a')?.dead === false);
  meshNode.close();
  fleet.removeNode('mesh-a');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) AUTONOMOUS SELF-EVOLUTION LOOP (closed loop)
// ─────────────────────────────────────────────────────────────────────────────
async function loopSuite(): Promise<void> {
  // 4a. Closed loop: failures → learner → stricter policy activation.
  const bus1 = new EventBus();
  const loop1 = new EvolutionLoop({ bus: bus1, proposeEvery: 2, minSamplesToPropose: 4, maxQueued: 128 });
  for (let i = 0; i < 8; i++) loop1.ingest('patch', 'src/api.ts', false, 40);
  loop1.tick();
  loop1.tick();
  const stats1 = loop1.getStats();
  check('loop: experiences flush into the learner', loop1.learnerState.query('patch')?.samples === 8, `samples=${loop1.learnerState.query('patch')?.samples}`);
  check('loop: failing regime activates a stricter policy', stats1.activations >= 1 && loop1.policyState.activeVersion >= 1 && loop1.policyState.active.rules.qualityGateStrict > 0.5, `v${loop1.policyState.activeVersion}, strict=${loop1.policyState.active.rules.qualityGateStrict}`);
  check('loop: evolved policy ledger verifies', loop1.policyState.verifyLedger());

  // 4b. Regression rollback: healthy baseline → candidate → bad regime.
  const bus2 = new EventBus();
  const loop2 = new EvolutionLoop({ bus: bus2, proposeEvery: 2, minSamplesToPropose: 4, maxQueued: 128, policy: new AdaptivePolicyEngine({ windowSize: 4, tolerance: 0.15 }) });
  for (let i = 0; i < 8; i++) loop2.ingest('patch', 'src/api.ts', true, 12); // healthy phase
  loop2.tick();
  loop2.tick(); // proposes relaxed gate (success ≥ 95%) → v1 activates
  const preVersion = loop2.policyState.activeVersion;
  check('loop: healthy phase proposes + activates', preVersion >= 1, `v${preVersion}`);
  for (let i = 0; i < 4; i++) loop2.ingest('patch', 'src/api.ts', false, 600); // catastrophic phase
  loop2.tick();
  check('loop: measured regression auto-rolls back', loop2.policyState.activeVersion === 0 && loop2.getStats().rollbacks >= 1, `v${loop2.policyState.activeVersion}, rollbacks=${loop2.getStats().rollbacks}`);

  // 4c. Fleet supervision runs inside the loop.
  const loop3 = new EvolutionLoop({ proposeEvery: 99, minSamplesToPropose: 999, fleet: new FleetOrchestrator({ graceMs: 60 }) });
  loop3.fleetState.registerNode('edge-1');
  loop3.fleetState.heartbeat('edge-1');
  await sleep(80);
  loop3.tick();
  check('loop: fleet sweep detects dead node', loop3.fleetState.stats().dead === 1 && loop3.getStats().healthyFleetNodes === 0, JSON.stringify(loop3.fleetState.stats()));

  // 4d. Background loop starts/stops cleanly (unref'd, non-blocking).
  const loop4 = new EvolutionLoop({ proposeEvery: 99, minSamplesToPropose: 999 });
  loop4.start(40);
  await sleep(130);
  loop4.stop();
  const ticks = loop4.getStats().ticks;
  check('loop: background loop ticks while started', ticks >= 2, `${ticks} ticks`);
  const afterStop = loop4.getStats().ticks;
  await sleep(60);
  check('loop: background loop stops cleanly', loop4.getStats().ticks === afterStop, `afterStop=${afterStop}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('=== KLYN AI OS PHASE 7 SMOKE ===');
  learnerSuite();
  await policySuite();
  await fleetSuite();
  await loopSuite();
  console.log(`\n=== PHASE 7 SMOKE SUMMARY: ${passes}/${passes + failures} checks passed ===`);
  if (failures > 0) process.exit(1);
}

void main();
