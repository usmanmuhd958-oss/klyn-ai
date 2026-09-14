import type { RequestHandler } from "express";

export const health: RequestHandler = (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "klyn-backend",
    version: "5.0.0"
  });
};

export const readiness: RequestHandler = (_req, res) => {
  res.status(200).json({ status: "ready" });
};
