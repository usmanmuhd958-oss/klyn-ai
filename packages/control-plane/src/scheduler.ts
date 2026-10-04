import { ControlPlaneError } from "./errors.js";
import type { ExecutionRequirements, PrivacyLevel, SchedulerWeights, WorkerNode, WorkerScore } from "./types.js";
import { brand, type WorkerId } from "./types.js";

export interface ScheduleDecision {
  readonly worker: WorkerNode;
  readonly score: WorkerScore;
  readonly considered: readonly WorkerScore[];
}

export class HeterogeneousScheduler {
  constructor(private readonly weights: SchedulerWeights = { latency: 1, cost: 0.5, locality: 0.75, queue: 0.75 }) {}

  assign(requirements: ExecutionRequirements, workers: readonly WorkerNode[]): ScheduleDecision {
    const candidates = workers.filter((worker) => isHardCompatible(requirements, worker));
    if (candidates.length === 0) throw new ControlPlaneError("NO_CAPABLE_WORKER", "NO_WORKER_PASSES_HARD_CONSTRAINTS");

    const scored = candidates.map((worker) => {
      const reasons: string[] = [];
      const localityPenalty = privacyDistance(requirements.privacy, worker.privacyDomain);
      if (localityPenalty === 0) reasons.push("privacy-domain-exact-match");
      if (worker.queueDepth === 0) reasons.push("empty-queue");
      if (worker.health === "HEALTHY") reasons.push("healthy");
      const score =
        this.weights.latency * normalize(worker.latencyP50Ms, 1, 2000) +
        this.weights.cost * normalize(worker.estimatedCostMilliunits, 1, 10000) +
        this.weights.locality * localityPenalty +
        this.weights.queue * normalize(worker.queueDepth, 0, Math.max(worker.queueDepth, requirements.maxQueueDepth ?? 100));
      return Object.freeze({ workerId: worker.nodeId, score, reasons });
    }).sort((a, b) => a.score - b.score);

    const selectedId = scored[0]?.workerId;
    if (!selectedId) throw new ControlPlaneError("NO_CAPABLE_WORKER", "SCORING_RETURNED_NO_WORKER");
    const worker = candidates.find((candidate) => candidate.nodeId === selectedId);
    if (!worker) throw new ControlPlaneError("NO_CAPABLE_WORKER", "SELECTED_WORKER_NOT_FOUND");
    return Object.freeze({ worker, score: scored[0]!, considered: Object.freeze(scored) });
  }
}

function isHardCompatible(r: ExecutionRequirements, w: WorkerNode): boolean {
  if (w.health === "UNAVAILABLE") return false;
  if (r.networkRequired && !w.networkAvailable) return false;
  if (w.availableMemoryBytes < r.minMemoryBytes) return false;
  if (w.availableCpuCores < r.minCpuCores) return false;
  if (r.gpuRequired && !w.hasGpu) return false;
  if (r.maxQueueDepth !== undefined && w.queueDepth > r.maxQueueDepth) return false;
  if (!capabilitiesContain(w.capabilities, r.requiredCapabilities)) return false;
  if (!capabilitiesContain(w.modelCapabilities, r.modelCapabilities)) return false;
  if (privacyDistance(r.privacy, w.privacyDomain) > 0) return false;
  if (r.locality === "LOCAL_ON_PREM_ONLY" && w.privacyDomain !== "LOCAL_ON_PREM_ONLY") return false;
  return true;
}

function capabilitiesContain(have: readonly string[], needed: readonly string[]): boolean {
  const set = new Set(have);
  return needed.every((item) => set.has(item));
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function privacyDistance(required: PrivacyLevel, worker: PrivacyLevel): number {
  const rank = (level: PrivacyLevel): number => {
    switch (level) {
      case "LOCAL_ON_PREM_ONLY": return 0;
      case "SOVEREIGN_CLOUD_ALLOWED": return 1;
      case "PUBLIC_CLOUD_ALLOWED": return 2;
    }
  };
  return rank(worker) < rank(required) ? 0 : worker === required ? 0 : 0.5;
}

export const workerId = (value: string): WorkerId => brand<string, "WorkerId">(value);
