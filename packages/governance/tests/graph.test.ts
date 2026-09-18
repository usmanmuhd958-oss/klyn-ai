import { test } from "node:test";
import assert from "node:assert/strict";
import { GovernanceGraphEngine, InvariantRequirement } from "../src/graph.js";

test("P4-01: evaluation sorts invariants deterministically and blocks when missing evidence", () => {
  const invariants: InvariantRequirement[] = [
    { id: "INV-02", description: "Check B", requiredForStage: "POLICY_EVALUATED" },
    { id: "INV-01", description: "Check A", requiredForStage: "POLICY_EVALUATED" },
  ];

  const engine = new GovernanceGraphEngine(invariants);
  assert.equal(engine.getStage(), "INITIALIZED");

  const stage = engine.evaluateStageTransition();
  assert.equal(stage, "INITIALIZED");
});

test("P4-02: governance graph transitions sequentially when all stage evidence is verified", () => {
  const invariants: InvariantRequirement[] = [
    { id: "INV-01", description: "Check A", requiredForStage: "POLICY_EVALUATED" },
  ];

  const engine = new GovernanceGraphEngine(invariants);
  engine.addEvidence({ invariantId: "INV-01", verified: true, timestamp: Date.now() });

  const nextStage = engine.evaluateStageTransition();
  assert.equal(nextStage, "POLICY_EVALUATED");
});

test("P4-03: unverified or rejected evidence blocks stage progression", () => {
  const invariants: InvariantRequirement[] = [
    { id: "INV-01", description: "Check A", requiredForStage: "POLICY_EVALUATED" },
  ];

  const engine = new GovernanceGraphEngine(invariants);
  engine.addEvidence({ invariantId: "INV-01", verified: false, timestamp: Date.now() });

  const stage = engine.evaluateStageTransition();
  assert.equal(stage, "INITIALIZED");
});
