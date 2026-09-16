import assert from "node:assert/strict";
import test from "node:test";
import { ConsensusArbitrator, ExecutionPlanner, IntentCompiler, IntentStateMachine, SelfHealingBridge, SwarmTaskDispatcher, TaskGraphCompiler, type IntentContent, type IntentSpec, type SwarmAgent } from "../src/index.js";

function content(): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: { statement: "Build verified capability", outcome: "Capability exists", scope: ["packages/cognitive-engine"] },
    constraints: [{ id: "backend", kind: "PROHIBITION", statement: "No frontend changes" }],
    assumptions: [{ id: "node", statement: "Node.js >= 22" }],
    dependencies: [{ id: "runtime", kind: "PACKAGE", name: "runtime", required: true, dependsOn: [] }, { id: "crypto", kind: "RESOURCE", name: "node:crypto", required: true, dependsOn: ["runtime"] }],
    acceptanceCriteria: [{ id: "tests", description: "Tests pass", verification: "TEST", required: true }],
    riskPolicy: { maxRiskLevel: "LOW", allowedActions: ["read", "write"], requireHumanApproval: false, autoPromotion: false },
    requiredEvidence: [{ id: "evidence", kind: "TEST_RESULT", description: "Test result", required: true }],
    resourceBudget: { maxCpuMillis: 10000, maxMemoryBytes: 1024 * 1024 * 1024, maxWallClockMillis: 30000, maxConcurrentTasks: 2, maxNetworkRequests: 10, maxArtifactBytes: 1024 * 1024 },
  };
}

function frozenIntent(): IntentSpec {
  const result = new IntentCompiler().compile(content());
  assert.equal(result.accepted, true);
  if (!result.accepted) throw new Error("fixture compilation failed");
  const machine = new IntentStateMachine();
  const validating = machine.transition({ ...result.spec, state: "DRAFT" }, "VALIDATING");
  return machine.transition(machine.transition(validating, "VALIDATED"), "FROZEN");
}

function agent(role: SwarmAgent["role"], id: string, result?: Partial<Awaited<ReturnType<SwarmAgent["execute"]>>>): SwarmAgent {
  return {
    agentId: id,
    role,
    execute: async () => ({ status: "SUCCEEDED", epistemicState: "OBSERVED", evidenceWeight: 0.9, value: id, ...result }),
  };
}

test("dispatcher enforces the execution strategy concurrency ceiling", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  let active = 0;
  let peak = 0;
  const make = (role: SwarmAgent["role"], id: string): SwarmAgent => ({ agentId: id, role, execute: async () => { active += 1; peak = Math.max(peak, active); await new Promise<void>((resolve) => setImmediate(resolve)); active -= 1; return { status: "SUCCEEDED", epistemicState: "OBSERVED", evidenceWeight: 0.9, value: id }; } });
  const result = await new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [make("ARCHITECT", "architect-1"), make("BUILDER", "builder-1"), make("BUILDER", "builder-2"), make("VALIDATOR", "validator-1"), make("EVIDENCE", "evidence-1")]);
  assert.equal(result.status, "SUCCEEDED");
  assert.ok(result.peakConcurrency <= intent.resourceBudget.maxConcurrentTasks);
  assert.ok(peak <= intent.resourceBudget.maxConcurrentTasks);
});

test("dispatcher deterministically assigns agents by task id", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  const runs: string[] = [];
  const builders = [agent("BUILDER", "builder-a"), agent("BUILDER", "builder-b")].map((item) => ({ ...item, execute: async (task: Parameters<SwarmAgent["execute"]>[0], context: Parameters<SwarmAgent["execute"]>[1]) => { runs.push(`${task.id}:${context.agentId}`); return item.execute(task, context); } }));
  const all = [agent("ARCHITECT", "architect-1"), ...builders, agent("VALIDATOR", "validator-1"), agent("EVIDENCE", "evidence-1")];
  await new SwarmTaskDispatcher().dispatch(intent, graph, strategy, all);
  const first = [...runs].sort();
  runs.length = 0;
  await new SwarmTaskDispatcher().dispatch(intent, graph, strategy, all);
  assert.deepEqual(first, [...runs].sort());
});

test("dispatcher rejects invalid evidence weights", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  await assert.rejects(new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [agent("ARCHITECT", "architect-1"), agent("BUILDER", "builder-1", { evidenceWeight: 2 }), agent("VALIDATOR", "validator-1"), agent("EVIDENCE", "evidence-1")]), /invalid evidence weight/);
});

test("dispatcher rejects role starvation before execution", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  await assert.rejects(new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [agent("ARCHITECT", "architect-1")]), /No swarm agent/);
});

test("weighted consensus accepts a supported decision with quorum", () => {
  const decision = new ConsensusArbitrator<string>(5).arbitrate([
    { agentId: "a", role: "ARCHITECT", state: "PASS", evidenceWeight: 0.9, epistemicState: "VERIFIED" },
    { agentId: "b", role: "BUILDER", state: "PASS", evidenceWeight: 0.8, epistemicState: "EVIDENCE-SUPPORTED" },
    { agentId: "c", role: "VALIDATOR", state: "PASS", evidenceWeight: 0.7, epistemicState: "VERIFIED" },
    { agentId: "d", role: "EVIDENCE", state: "FAIL", evidenceWeight: 0.1, epistemicState: "OBSERVED" },
    { agentId: "e", role: "VALIDATOR", state: "FAIL", evidenceWeight: 0.1, epistemicState: "OBSERVED" },
  ]);
  assert.equal(decision.disposition, "ACCEPT");
  assert.equal(decision.quorum, 3);
  assert.equal(decision.winningState, "PASS");
  assert.ok(decision.weightedSupport > 0.7);
});

test("weighted consensus rejects split-brain", () => {
  const decision = new ConsensusArbitrator<string>(5).arbitrate([
    { agentId: "a", role: "ARCHITECT", state: "PASS", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "b", role: "BUILDER", state: "PASS", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "c", role: "VALIDATOR", state: "FAIL", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "d", role: "EVIDENCE", state: "FAIL", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "e", role: "VALIDATOR", state: "FAIL", evidenceWeight: 0, epistemicState: "UNKNOWN" },
  ]);
  assert.equal(decision.disposition, "REJECT");
});

test("consensus rejects duplicate votes and empty vote sets", () => {
  const arbitrator = new ConsensusArbitrator<string>(3);
  assert.throws(() => arbitrator.arbitrate([]), /At least one vote/);
  assert.throws(() => arbitrator.arbitrate([{ agentId: "a", role: "ARCHITECT", state: "PASS", evidenceWeight: 1, epistemicState: "VERIFIED" }, { agentId: "a", role: "VALIDATOR", state: "FAIL", evidenceWeight: 1, epistemicState: "VERIFIED" }]), /Duplicate vote/);
});

test("self-healing bridge detects deadlock and deterministically resolves a victim", async () => {
  const calls: string[] = [];
  const bridge = new SelfHealingBridge<readonly string[]>({ evictLock: async (id) => { calls.push(`evict:${id}`); }, rewind: async (state) => { calls.push(`rewind:${state.revision}`); } });
  bridge.transition("CLAIMED", "claim");
  bridge.transition("OBSERVED", "observation");
  const result = await bridge.heal([{ waiter: "agent-a", holder: "agent-b", resource: "lock-1" }, { waiter: "agent-b", holder: "agent-a", resource: "lock-2" }], { revision: 7, value: ["safe"] });
  assert.equal(result.healed, true);
  assert.equal(result.recovery?.victim, "agent-b");
  assert.deepEqual(calls, ["evict:agent-b", "rewind:7"]);
  assert.equal(result.snapshot.state, "UNKNOWN");
});

test("self-healing bridge rejects epistemic regression", () => {
  const bridge = new SelfHealingBridge<readonly string[]>({ evictLock: () => undefined, rewind: () => undefined });
  bridge.transition("CLAIMED", "claim");
  bridge.transition("OBSERVED", "observation");
  bridge.transition("EVIDENCE-SUPPORTED", "evidence");
  bridge.transition("VERIFIED", "verification");
  assert.throws(() => bridge.transition("CLAIMED", "regression"), /regression|Invalid epistemic transition/);
});

test("split-brain arbitration triggers safe-state rewind and preserves epistemic integrity", async () => {
  const rewinds: number[] = [];
  const bridge = new SelfHealingBridge<readonly string[]>({ evictLock: () => undefined, rewind: async (state) => { rewinds.push(state.revision); } });
  const decision = new ConsensusArbitrator<string>(3).arbitrate([
    { agentId: "a", role: "ARCHITECT", state: "PASS", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "b", role: "VALIDATOR", state: "FAIL", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "c", role: "EVIDENCE", state: "FAIL", evidenceWeight: 0, epistemicState: "UNKNOWN" },
  ]);
  assert.equal(decision.disposition, "REJECT");
  const outcome = await bridge.recoverConsensus(decision, { revision: 11, value: ["safe"] });
  assert.equal(outcome.healed, true);
  assert.deepEqual(rewinds, [11]);
  assert.equal(outcome.snapshot.state, "UNKNOWN");
});

test("accepted arbitration advances epistemic state without recovery", async () => {
  const rewinds: number[] = [];
  const bridge = new SelfHealingBridge<readonly string[]>({ evictLock: () => undefined, rewind: async (state) => { rewinds.push(state.revision); } });
  bridge.transition("CLAIMED", "proposal created");
  const decision = new ConsensusArbitrator<string>(3).arbitrate([
    { agentId: "a", role: "VALIDATOR", state: "PASS", evidenceWeight: 0.9, epistemicState: "VERIFIED" },
    { agentId: "b", role: "EVIDENCE", state: "PASS", evidenceWeight: 0.9, epistemicState: "VERIFIED" },
    { agentId: "c", role: "ARCHITECT", state: "FAIL", evidenceWeight: 0.1, epistemicState: "OBSERVED" },
  ]);
  bridge.arbitrate(decision);
  const outcome = await bridge.recoverConsensus(decision, { revision: 13, value: ["safe"] });
  assert.equal(bridge.snapshot.state, "EVIDENCE-SUPPORTED");
  assert.equal(outcome.healed, false);
  assert.deepEqual(rewinds, []);
});
