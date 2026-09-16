import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseExecutionLedgerSync, type RealtimePayload, type SupabaseLedgerClient, type SupabaseChannel, type SupabaseQueryResult, type SupabaseTableQuery } from "../src/supabase/execution-ledger-sync.js";

class MockTable implements SupabaseTableQuery {
  readonly upserts: Array<{ values: Record<string, unknown>; options?: { onConflict?: string } }> = [];
  readonly inserts: Record<string, unknown>[] = [];
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }): Promise<SupabaseQueryResult> {
    this.upserts.push({ values: values as Record<string, unknown>, options });
    return Promise.resolve({ data: values, error: null });
  }
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Promise<SupabaseQueryResult> {
    this.inserts.push(...(Array.isArray(values) ? values : [values]));
    return Promise.resolve({ data: values, error: null });
  }
}

class MockChannel implements SupabaseChannel {
  readonly filters: Record<string, unknown>[] = [];
  callback: ((payload: RealtimePayload) => void) | undefined;
  unsubscribed = false;
  on(_event: "postgres_changes", filter: Record<string, unknown>, callback: (payload: RealtimePayload) => void): SupabaseChannel {
    this.filters.push(filter);
    this.callback = callback;
    return this;
  }
  subscribe(): SupabaseChannel { return this; }
  unsubscribe(): Promise<void> { this.unsubscribed = true; return Promise.resolve(); }
}

class MockClient implements SupabaseLedgerClient {
  readonly tables = new Map<string, MockTable>();
  readonly channels = new Map<string, MockChannel>();
  from(table: string): SupabaseTableQuery {
    const current = this.tables.get(table) ?? new MockTable();
    this.tables.set(table, current);
    return current;
  }
  channel(name: string): SupabaseChannel {
    const current = new MockChannel();
    this.channels.set(name, current);
    return current;
  }
}

test("publishes execution and DAG state idempotently", async () => {
  const client = new MockClient();
  const sync = new SupabaseExecutionLedgerSync(client);

  await sync.publish({ type: "execution.state", executionId: "e1", status: "running", dagId: "dag-1" });
  await sync.publish({ type: "dag.state", executionId: "e1", dagId: "dag-1", nodeId: "node-a", state: "succeeded", attempt: 1 });

  assert.equal(client.tables.get("executions")?.upserts[0]?.options?.onConflict, "execution_id");
  assert.equal(client.tables.get("executions")?.upserts[0]?.values.execution_id, "e1");
  assert.equal(client.tables.get("dag_states")?.upserts[0]?.options?.onConflict, "execution_id,node_id");
  assert.equal(client.tables.get("dag_states")?.upserts[0]?.values.state, "succeeded");
});

test("records agent logs and provider token telemetry", async () => {
  const client = new MockClient();
  const sync = new SupabaseExecutionLedgerSync(client);

  await sync.publish({ type: "agent.log", executionId: "e1", agentId: "a1", level: "info", event: "task_started" });
  await sync.publish({ type: "provider.telemetry", executionId: "e1", agentId: "a1", provider: "openai", model: "gpt-test", attempt: 1, status: "success", inputTokens: 12, outputTokens: 8, totalTokens: 20, latencyMs: 15 });

  assert.equal(client.tables.get("agent_logs")?.inserts[0]?.event, "task_started");
  assert.equal(client.tables.get("provider_telemetry")?.inserts[0]?.provider, "openai");
  assert.equal(client.tables.get("provider_telemetry")?.inserts[0]?.total_tokens, 20);
});

test("subscribes to public realtime changes and exposes deterministic teardown", async () => {
  const client = new MockClient();
  const sync = new SupabaseExecutionLedgerSync(client, { channelName: "test-ledger" });
  const received: RealtimePayload[] = [];
  const subscription = sync.subscribe("dag_states", (payload) => received.push(payload));
  const channel = client.channels.get("test-ledger:dag_states");
  assert.ok(channel);
  assert.deepEqual(channel.filters[0], { event: "*", schema: "public", table: "dag_states" });

  channel.callback?.({ eventType: "UPDATE", table: "dag_states", schema: "public", new: { node_id: "node-a" }, old: {} });
  assert.equal(received.length, 1);
  await subscription.unsubscribe();
  assert.equal(channel.unsubscribed, true);
});

test("propagates Supabase write errors", async () => {
  const client = new MockClient();
  const table = client.from("executions") as MockTable;
  table.upsert = () => Promise.resolve({ data: null, error: { message: "permission denied" } });
  const sync = new SupabaseExecutionLedgerSync(client);

  await assert.rejects(
    sync.publish({ type: "execution.state", executionId: "e1", status: "queued" }),
    /Supabase ledger write failed for executions: permission denied/,
  );
});
