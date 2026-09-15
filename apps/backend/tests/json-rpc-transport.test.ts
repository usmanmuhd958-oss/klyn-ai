import assert from "node:assert/strict";
import test from "node:test";
import { JsonRpcAgentIpcTransport, startJsonRpcAgentIpcServer } from "../src/ipc/json-rpc-transport.js";

test("JSON-RPC IPC round trip over loopback", async () => {
  const service = {
    execute: async (req: any) => ({
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
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
