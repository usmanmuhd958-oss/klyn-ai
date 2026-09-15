import assert from "node:assert/strict";
import test from "node:test";
import { closeJsonRpcAgentIpcServer, JsonRpcAgentIpcTransport, startJsonRpcAgentIpcServer } from "../src/ipc/json-rpc-transport.js";

test("JSON-RPC IPC round trip over loopback", async () => {
  const service = {
    execute: async (req: { executionId: string }) => ({
      executionId: req.executionId,
      result: { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 },
    }),
  };

  const server = await startJsonRpcAgentIpcServer(service, { port: 0 });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const transport = new JsonRpcAgentIpcTransport("127.0.0.1", address.port);
  try {
    const response = await transport.call({
      executionId: "e1",
      treeId: "t1",
      agentId: "a1",
      request: { language: "javascript", source: "1" },
    });
    assert.equal(response.executionId, "e1");
    assert.equal(response.result.stdout, "ok");
  } finally {
    transport.close();
    await closeJsonRpcAgentIpcServer(server);
  }
});

test("JSON-RPC rejects invalid execution params", async () => {
  const server = await startJsonRpcAgentIpcServer({
    execute: async () => ({
      executionId: "never",
      result: { exitCode: 0, stdout: "", stderr: "", durationMs: 0 },
    }),
  }, { port: 0 });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const transport = new JsonRpcAgentIpcTransport("127.0.0.1", address.port);
  try {
    await assert.rejects(
      transport.call({
        executionId: "e2",
        treeId: "t2",
        agentId: "a2",
        request: { language: "javascript", source: "1", timeoutMs: 0 },
      }),
    );
  } finally {
    transport.close();
    await closeJsonRpcAgentIpcServer(server);
  }
});

test("JSON-RPC server lifecycle closes active connections promptly", async () => {
  const server = await startJsonRpcAgentIpcServer({
    execute: async () => await new Promise(() => undefined),
  }, { port: 0 });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const transport = new JsonRpcAgentIpcTransport("127.0.0.1", address.port);
  const pending = transport.call({
    executionId: "e3",
    treeId: "t3",
    agentId: "a3",
    request: { language: "javascript", source: "1" },
  });

  try {
    await new Promise((resolve) => setImmediate(resolve));
    const started = performance.now();
    await closeJsonRpcAgentIpcServer(server);
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 100, `server teardown took ${elapsedMs.toFixed(2)}ms`);
    await assert.rejects(pending);
  } finally {
    transport.close();
  }
});
