import express from "express";
import { health, readiness } from "./api/health.js";
import { KernelHealthController } from "./kernel-health.js";
import { loadEnv } from "./config/env.js";

export * from "./ipc/agent-service.js";
export * from "./ipc/json-rpc-transport.js";
export * from "./supabase/execution-ledger-sync.js";
export * from "./kernel-health.js";

const env = loadEnv();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.get("/health", health);
app.get("/health/kernel", (_req, res) => res.status(200).json(new KernelHealthController().collect()));
app.get("/ready", readiness);
const server = app.listen(env.PORT, env.HOST, () => console.log(`Klyn backend listening on http://${env.HOST}:${env.PORT}`));
function shutdown(signal: string): void { console.log(`Received ${signal}; shutting down backend`); server.close((error) => { if (error) { console.error(error); process.exitCode = 1; return; } process.exit(0); }); }
process.once("SIGTERM", () => shutdown("SIGTERM")); process.once("SIGINT", () => shutdown("SIGINT"));
