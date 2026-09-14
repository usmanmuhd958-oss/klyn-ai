import express from "express";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "klyn-backend",
    version: "5.0.0"
  });
});

app.get("/ready", (_req, res) => {
  res.status(200).json({ status: "ready" });
});

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Klyn backend listening on http://${env.HOST}:${env.PORT}`);
});

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
