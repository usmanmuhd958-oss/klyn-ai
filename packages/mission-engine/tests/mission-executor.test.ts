import { strict as assert } from "node:assert";
import { test } from "node:test";
import { digestJson, MissionExecutionRunner, MissionStateMachine, VerifiableMissionGraph } from "../src/index.js";
import type { MissionEvidence, MissionGraph } from "../src/types.js";

const graphBase: Omit<MissionGraph, "graphDigest"> = {
  schemaVersion: "1.0.0",
  missionId: "mission-test",
  objectiveId: "objective-test",
  nodes: [
    { nodeId: "action", state: "ACTION_EXECUTED", invariantIds: ["i1"], dependsOn: [] },
    { nodeId: "artifact", state: "ARTIFACT_PRODUCED", invariantIds: ["i1"], dependsOn: ["action"] },
    { nodeId: "test", state: "TEST_PASSED", invariantIds: ["i1"], dependsOn: ["artifact"] },
    { nodeId: "verify", state: "REQUIREMENT_VERIFIED", invariantIds: ["i1"], dependsOn: ["test"] },
    { nodeId: "deploy", state: "DEPLOYMENT_CONFIRMED", invariantIds: ["i1"], dependsOn: ["verify"] },
  ],
  invariants: [{ invariantId: "i1", statement: "artifact satisfies objective" }],
};
const graph = new VerifiableMissionGraph({
  ...graphBase,
  graphDigest: digestJson(graphBase),
});

test("MissionExecutionRunner drives the mission state machine to deployment confirmation", async () => {
  let sequence = 0;
  const machine = new MissionStateMachine(graph, {
    evidenceVerifier: { verifierId: "test-verifier", verify: () => true },
  });
  const runner = new MissionExecutionRunner(
    graph,
    machine,
    {
      async execute(context) {
        return `${context.node.state}-output-${++sequence}`;
      },
    },
    {
      create({ node, output, previous }): MissionEvidence {
        const artifactDigest = node.state === "ACTION_EXECUTED" ? undefined : "b".repeat(64);
        return {
          evidenceId: `e-${sequence}`,
          missionId: previous.missionId,
          objectiveId: graph.graph.objectiveId,
          nodeId: node.nodeId,
          kind: {
            ACTION_EXECUTED: "action-receipt",
            ARTIFACT_PRODUCED: "artifact-manifest",
            TEST_PASSED: "test-result",
            REQUIREMENT_VERIFIED: "requirement-proof",
            DEPLOYMENT_CONFIRMED: "deployment-attestation",
          }[node.state]!,
          statement: String(output),
          payloadDigest: "a".repeat(64),
          ...(artifactDigest === undefined ? {} : { artifactDigest }),
          invariantIds: [...node.invariantIds],
          predecessorEvidenceIds: [...(previous.evidenceIds.length === 0 ? [] : [previous.evidenceIds[previous.evidenceIds.length - 1]!])],
          issuedAtEpochMs: Date.now(),
          verifierId: "test-verifier",
        };
      },
    },
  );

  const result = await runner.run();
  assert.equal(result.completed, true);
  assert.equal(result.snapshot.currentState, "DEPLOYMENT_CONFIRMED");
  assert.equal(result.steps.length, 5);
});
