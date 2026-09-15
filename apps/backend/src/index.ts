import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

export * from "./ipc/agent-service.js";
export * from "./ipc/json-rpc-transport.js";
export * from "./supabase/execution-ledger-sync.js";
export * from "./kernel-health.js";
export * from "./distributed-state.js";
export * from "./node-heartbeat-monitor.js";
export * from "./master-execution-orchestrator.js";

const env = loadEnv();
const app = createApp();
const server = app.listen(env.PORT, env.HOST, () =>
  console.log(`Klyn backend listening on http://${env.HOST}:${env.PORT}`),
);

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down backend`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
      return;
    }

    process.exit(0);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
