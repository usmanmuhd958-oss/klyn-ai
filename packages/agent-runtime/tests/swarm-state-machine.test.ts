import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SwarmStateMachine, type SwarmTask } from "../src/index.ts";

test("swarm state machine executes dependency graph with bounded concurrency", async () => {
  const tasks: SwarmTask[] = [
    {
      id: "plan",
      agentId: "planner",
      execute: async () => "plan-output",
    },
    {
      id: "research",
      agentId: "researcher",
      execute: async () => "research-output",
    },
    {
      id: "implement",
      agentId: "coder",
      dependsOn: ["plan", "research"],
      execute: async ({ dependencyOutputs }) => {
        assert.equal(dependencyOutputs.plan, "plan-output");
        assert.equal(dependencyOutputs.research, "research-output");
        return "implementation-output";
      },
    },
  ];

  const machine = new SwarmStateMachine(tasks, "swarm-test");
  const result = await machine.run({ maxConcurrency: 2 });

  assert.deepEqual(result.succeeded, ["implement", "plan", "research"]);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.outputs.implement, "implementation-output");
  assert.equal(result.snapshot.states.plan?.state, "succeeded");
  assert.equal(result.snapshot.states.implement?.state, "succeeded");
});

test("swarm state machine blocks descendants of failed tasks", async () => {
  const tasks: SwarmTask[] = [
    {
      id: "broken",
      agentId: "coder",
      execute: async () => {
        throw new Error("compile failed");
      },
    },
    {
      id: "dependent",
      agentId: "reviewer",
      dependsOn: ["broken"],
      execute: async () => "unreachable",
    },
  ];

  const machine = new SwarmStateMachine(tasks, "swarm-failure-test");
  const result = await machine.run();

  assert.deepEqual(result.failed, ["broken"]);
  assert.deepEqual(result.blocked, ["dependent"]);
  assert.equal(result.snapshot.states.dependent?.error, "dependency did not succeed");
});
