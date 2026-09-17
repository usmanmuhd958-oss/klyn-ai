import { createRequire } from "node:module";
import type { RequestHandler } from "express";

const require = createRequire(import.meta.url);
const packageJson = require("../../../../package.json") as { version: string };

export const health: RequestHandler = (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "klyn-backend",
    version: packageJson.version,
  });
};

export const readiness: RequestHandler = (_req, res) => {
  res.status(200).json({ status: "ready" });
};
