import { strict as assert } from "node:assert";
import test from "node:test";
import { PlannerStateConflictError } from "../../src/types/planner-persistence.types.js";
import { SupabasePlannerStateStore } from "../../src/runtime/supabase-planner-state-store.js";

test("CAS adapter increments state_version and maps the returned row", async () => {
  let request: Request | undefined;
  const store = new SupabasePlannerStateStore(
    { supabaseUrl: "https://example.supabase.co", apiKey: "publishable", accessToken: "token", ownerUserId: "user-1" },
    async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify([{
        execution_id: "exec-1", task_id: "task-a", namespace: "klyn", phase: 1, status: "queued",
        prerequisites: [], completed_prerequisites: [], execution_order: 1, state_version: 2, node: {}, metadata: {},
      }]), { status: 200, headers: { "content-type": "application/json" } });
    },
  );
  const state = await store.compareAndSwap({ executionId: "exec-1", taskId: "task-a", expectedStateVersion: 1, status: "queued", phase: 1, prerequisites: [], completedPrerequisites: [], executionOrder: 1, node: {} });
  assert.equal(state.stateVersion, 2);
  assert.ok(request);
  const body = await request?.json() as { state_version: number };
  assert.equal(body.state_version, 2);
  assert.match(request?.url ?? "", /state_version=eq\.1/);
});

test("CAS adapter turns zero-row updates into typed stale conflicts", async () => {
  const store = new SupabasePlannerStateStore(
    { supabaseUrl: "https://example.supabase.co", apiKey: "publishable", accessToken: "token", ownerUserId: "user-1" },
    async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  );
  await assert.rejects(
    () => store.compareAndSwap({ executionId: "exec-1", taskId: "task-a", expectedStateVersion: 7, status: "executing", phase: 1, prerequisites: [], completedPrerequisites: [], executionOrder: 1, node: {} }),
    (error: unknown) => error instanceof PlannerStateConflictError && error.expectedStateVersion === 7,
  );
});
