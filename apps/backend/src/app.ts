import express from "express";
import { health, readiness } from "./api/health.js";
import { KernelHealthController } from "./kernel-health.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", health);
  app.get("/health/kernel", (_req, res) =>
    res.status(200).json(new KernelHealthController().collect()),
  );
  app.get("/ready", readiness);

  return app;
}
