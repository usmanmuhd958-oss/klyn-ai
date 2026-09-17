import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";

test("GET /health returns the stable backend contract", async (t) => {
  const server = createServer(createApp());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);

  const body: unknown = await response.json();
  assert.deepEqual(body, {
    status: "ok",
    service: "klyn-backend",
    version: "6.1.0",
  });
});
