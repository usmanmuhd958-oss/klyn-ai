import assert from "node:assert/strict";
import test from "node:test";
import {
  ConsensusArbitrator,
  ExecutionPlanner,
  IntentCompiler,
  IntentStateMachine,
  SelfHealingBridge,
  SwarmTaskDispatcher,
  TaskGraphCompiler,
  type IntentContent,
  type IntentSpec,
  type SwarmAgent,
} from "../src/index.js";

function content(): IntentContent {
  return {
    specVersion: "1.0.0",
    objective: { statement: "Build verified capability", outcome: "Capability exists", scope: ["packages/cognitive-engine"] },
    constraints: [{ id: "backend", kind: "PROHIBITION", statement: "No frontend changes" }],
    assumptions: [{ id: "node", statement: "Node.js >= 22" }],
    dependencies: [
      { id: "runtime", kind: "PACKAGE", name: "runtime", required: true, dependsOn: [] },
      { id: "crypto", kind: "RESOURCE", name: "node:crypto", required: true, dependsOn: ["runtime"] },
    ],
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
  const validated = machine.transition(validating, "VALIDATED");
  return machine.transition(validated, "FROZEN");
}

function swarm(intent: IntentSpec, peak: { value: number }): readonly SwarmAgent[] {
  const run = async (_task: Parameters<SwarmAgent["execute"]>[0], _context: Parameters<SwarmAgent["execute"]>[1]) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    peak.value += 1;
    return { status: "SUCCEEDED" as const, epistemicState: "OBSERVED" as const, evidenceWeight: 0.8, value: intent.intentId };
  };
  return [
    { agentId: "architect-1", role: "ARCHITECT", execute: run },
    { agentId: "builder-1", role: "BUILDER", execute: run },
    { agentId: "builder-2", role: "BUILDER", execute: run },
    { agentId: "validator-1", role: "VALIDATOR", execute: run },
    { agentId: "evidence-1", role: "EVIDENCE", execute: run },
  ];
}

test("dispatcher enforces the execution strategy concurrency ceiling", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  const active = { value: 0, peak: 0 };
  const agent = (role: SwarmAgent["role"], id: string): SwarmAgent => ({
    agentId: id,
    role,
    execute: async (_task, _context) => {
      active.value += 1;
      active.peak = Math.max(active.peak, active.value);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active.value -= 1;
      return { status: "SUCCEEDED", epistemicState: "OBSERVED", evidenceWeight: 0.9, value: id };
    },
  });
  const result = await new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [
    agent("ARCHITECT", "architect-1"),
    agent("BUILDER", "builder-1"),
    agent("BUILDER", "builder-2"),
    agent("VALIDATOR", "validator-1"),
    agent("EVIDENCE", "evidence-1"),
  ]);
  assert.equal(result.status, "SUCCEEDED");
  assert.ok(result.peakConcurrency <= intent.resourceBudget.maxConcurrentTasks);
  assert.ok(active.peak <= intent.resourceBudget.maxConcurrentTasks);
});

test("dispatcher deterministically assigns the same agent to identical task ids", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  const make = (id: string): SwarmAgent => ({ agentId: id, role: "BUILDER", execute: async () => ({ status: "SUCCEEDED", epistemicState: "OBSERVED", evidenceWeight: 0.7, value: id }) });
  const agents = [make("builder-a"), make("builder-b")];
  const runs: string[][] = [];
  const instrumented = agents.map((agent) => ({ ...agent, execute: async (task: Parameters<SwarmAgent["execute"]>[0], context: Parameters<SwarmAgent["execute"]>[1]) => { const record = runs[0] ?? []; record.push(`${task.id}:${context.agentId}`); runs[0] = record; return agent.execute(task, context); } }));
  await new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [
    { agentId: "architect-1", role: "ARCHITECT", execute: instrumented[0].execute },
    ...instrumented,
    { agentId: "validator-1", role: "VALIDATOR", execute: instrumented[0].execute },
    { agentId: "evidence-1", role: "EVIDENCE", execute: instrumented[0].execute },
  ]);
  const firstRun = [...runs[0]].sort();
  runs.length = 0;
  await new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [
    { agentId: "architect-1", role: "ARCHITECT", execute: instrumented[0].execute },
    ...instrumented,
    { agentId: "validator-1", role: "VALIDATOR", execute: instrumented[0].execute },
    { agentId: "evidence-1", role: "EVIDENCE", execute: instrumented[0].execute },
  ]);
  assert.deepEqual(firstRun, [...runs[0]].sort());
});

test("dispatcher rejects invalid evidence weights and role starvation", async () => {
  const intent = frozenIntent();
  const graph = new TaskGraphCompiler().compile(intent);
  const strategy = new ExecutionPlanner().plan(intent, graph);
  await assert.rejects(
    new SwarmTaskDispatcher().dispatch(intent, graph, strategy, [{ agentId: "architect", role: "ARCHITECT", execute: async () => ({ status: "SUCCEEDED", epistemicState: "OBSERVED", evidenceWeight: 2, value: "bad" }) }]),
    /invalid evidence weight/,
  );
});

test("weighted consensus accepts a supported decision with quorum", () => {
  const arbitrator = new ConsensusArbitrator<string>(5);
  const decision = arbitrator.arbitrate([
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

test("weighted consensus rejects split-brain despite raw majority possibility", () => {
  const arbitrator = new ConsensusArbitrator<string>(5);
  const decision = arbitrator.arbitrate([
    { agentId: "a", role: "ARCHITECT", state: "PASS", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "b", role: "BUILDER", state: "PASS", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "c", role: "VALIDATOR", state: "FAIL", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "d", role: "EVIDENCE", state: "FAIL", evidenceWeight: 0.5, epistemicState: "OBSERVED" },
    { agentId: "e", role: "VALIDATOR", state: "FAIL", evidenceWeight: 0.0, epistemicState: "UNKNOWN" },
  ]);
  assert.equal(decision.disposition, "REJECT");
});

test("consensus rejects duplicate agent votes and accepts no vote only as an error", () => {
  const arbitrator = new ConsensusArbitrator<string>(3);
  assert.throws(() => arbitrator.arbitrate([]), /At least one vote/);
  assert.throws(() => arbitrator.arbitrate([
    { agentId: "a", role: "ARCHITECT", state: "PASS", evidenceWeight: 1, epistemicState: "VERIFIED" },
    { agentId: "a", role: "VALIDATOR", state: "FAIL", evidenceWeight: 1, epistemicState: "VERIFIED" },
  ]), /Duplicate vote/);
});

test("self-healing bridge detects deadlock and deterministically resolves a victim", async () => {
  const calls: string[] = [];
  const bridge = new SelfHealingBridge<readonly string[]>({
    evictLock: async (agentId) => { calls.push(`evict:${agentId}`); },
    rewind: async (state) => { calls.push(`rewind:${state.revision}`); },
  });
  bridge.transition("CLAIMED", "Agent submitted a claim");
  bridge.transition("OBSERVED", "Agent output observed");
  const result = await bridge.heal([
    { waiter: "agent-a", holder: "agent-b", resource: "lock-1" },
    { waiter: "agent-b", holder: "agent-a", resource: "lock-2" },
  ], { revision: 7, value: ["safe"] });
  assert.equal(result.healed, true);
  assert.equal(result.recovery?.victim, "agent-b");
  assert.deepEqual(calls, ["evict:agent-b", "rewind:7"]);
  assert.equal(result.snapshot.state, "UNKNOWN");
});

test("self-healing bridge forbids epistemic regression during normal transitions", () => {
  const bridge = new SelfHealingBridge<readonly string[]>({ evictLock: () => undefined, rewind: () => undefined });
  bridge.transition("CLAIMED", "claim recorded");
  bridge.transition("OBSERVED", "observation recorded");
  bridge.transition("EVIDENCE-SUPPORTED", "evidence recorded");
  bridge.transition("VERIFIED", "verification recorded");
  assert.throws(() => bridge.transition("CLAIMED", "regression"), /regression|Invalid epistemic transition/);
});

test("self-healing arbitration integration advances evidence state only on acceptance", () => {
  const bridge = new SelfHealingBridge<readonly string[]>({ evictLock: () => undefined, rewind: () => undefined });
  bridge.transition("CLAIMED", "proposal created");
  const arbitrator = new ConsensusArbitrator<string>(3);
  const decision = arbitrator.arbitrate([
    { agentId: "a", role: "VALIDATOR", state: "PASS", evidenceWeight: 0.9, epistemicState: "VERIFIED" },
    { agentId: "b", role: "EVIDENCE", state: "PASS", evidenceWeight: 0.9, epistemicState: "VERIFIED" },
    { agentId: "c", role: "ARCHITECT", state: "FAIL", evidenceWeight: 0.1, epistemicState: "OBSERVED" },
  ]);
  bridge.arbitrate(decision);
  assert.equal(bridge.snapshot.state, "EVIDENCE-SUPPORTED");
});
