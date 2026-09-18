import { hmacSha256 } from "./crypto.js";
import { ControlPlaneError } from "./errors.js";
import { newEnvelopeId } from "./ids.js";
import type { Capability, ExecutionId, MissionId, ResourceEnvelope, ResourceReservation, ResourceUsage, TokenBudget, ComputeBudget, LatencyBudget, NetworkPolicy } from "./types.js";

export interface EnvelopeInput {
  readonly missionId: MissionId;
  readonly executionId: ExecutionId;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly tokenBudget: TokenBudget;
  readonly computeBudget: ComputeBudget;
  readonly latencyBudget: LatencyBudget;
  readonly allowedCapabilities: readonly Capability[];
  readonly networkPolicy: NetworkPolicy;
}

export class ResourceEnvelopeEngine {
  private readonly reservations = new Map<string, ResourceReservation>();
  private readonly consumed = new Map<string, ResourceUsage>();
  private readonly reserved = new Map<string, ResourceUsage>();

  constructor(private readonly signingKey: string) {}

  async create(input: EnvelopeInput): Promise<ResourceEnvelope> {
    const issuedAt = Date.parse(input.issuedAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      throw new ControlPlaneError("ENVELOPE_EXPIRED", "INVALID_ENVELOPE_LIFETIME");
    }
    if (input.latencyBudget.toolTimeoutMs > input.latencyBudget.executionTimeoutMs || input.latencyBudget.executionTimeoutMs > input.latencyBudget.missionTimeoutMs) {
      throw new ControlPlaneError("GUARD_FAILED", "LATENCY_BUDGET_HIERARCHY_VIOLATION");
    }
    if (input.tokenBudget.inputMax + input.tokenBudget.outputMax < input.tokenBudget.totalMax) {
      throw new ControlPlaneError("GUARD_FAILED", "TOTAL_TOKEN_CAP_EXCEEDS_INPUT_PLUS_OUTPUT_CAPS");
    }
    if (input.expiresAt !== new Date(expiresAt).toISOString()) throw new ControlPlaneError("GUARD_FAILED", "NON_CANONICAL_EXPIRATION");
    if (expiresAt <= Date.now()) throw new ControlPlaneError("ENVELOPE_EXPIRED", "ENVELOPE_ALREADY_EXPIRED");

    const envelopeId = newEnvelopeId();
    const unsigned = JSON.stringify({
      envelopeId,
      missionId: input.missionId,
      executionId: input.executionId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      tokenBudget: serializeBudget(input.tokenBudget),
      computeBudget: serializeBudget(input.computeBudget),
      latencyBudget: input.latencyBudget,
      allowedCapabilities: [...input.allowedCapabilities].sort(),
      networkPolicy: input.networkPolicy,
    });
    const signature = await hmacSha256(this.signingKey, unsigned);
    return Object.freeze({ ...input, envelopeId, signature });
  }

  reserve(envelope: ResourceEnvelope, reservation: Omit<ResourceReservation, "committed">): ResourceReservation {
    if (Date.now() >= Date.parse(envelope.expiresAt)) throw new ControlPlaneError("ENVELOPE_EXPIRED", "ENVELOPE_EXPIRED");
    this.ensureCapacity(envelope, reservation);
    const existing = this.reservations.get(reservation.reservationId);
    if (existing) return existing;
    const currentReserved = this.reserved.get(envelope.envelopeId) ?? zeroUsage();
    const aggregateReserved = addReservable(currentReserved, reservation);
    this.ensureCumulativeReservationWithinEnvelope(envelope, aggregateReserved);
    const next = Object.freeze({ ...reservation, committed: false });
    this.reservations.set(reservation.reservationId, next);
    this.reserved.set(envelope.envelopeId, aggregateReserved);
    return next;
  }

  settle(envelope: ResourceEnvelope, reservationId: string, usage: ResourceUsage): ResourceReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new ControlPlaneError("BUDGET_EXCEEDED", "UNKNOWN_RESERVATION");
    if (reservation.committed) return reservation;
    this.ensureUsageWithinReservation(reservation, usage);
    const previous = this.consumed.get(envelope.envelopeId) ?? zeroUsage();
    const total = addUsage(previous, usage);
    this.ensureCumulativeUsageWithinEnvelope(envelope, total);
    const currentReserved = this.reserved.get(envelope.envelopeId) ?? zeroUsage();
    this.reserved.set(envelope.envelopeId, subtractReservation(currentReserved, reservation));
    this.consumed.set(envelope.envelopeId, total);
    const committed = Object.freeze({ ...reservation, committed: true });
    this.reservations.set(reservationId, committed);
    return committed;
  }

  usage(envelopeId: ResourceEnvelope["envelopeId"]): ResourceUsage {
    return this.consumed.get(envelopeId) ?? zeroUsage();
  }

  private ensureCapacity(envelope: ResourceEnvelope, r: Omit<ResourceReservation, "committed">): void {
    if (r.inputTokens < 0n || r.outputTokens < 0n || r.cpuMillicoresMs < 0 || r.memoryBytes < 0n || r.gpuMillicoresMs < 0 || r.diskWriteBytes < 0n || r.networkEgressBytes < 0n || r.wallClockMs < 0) {
      throw new ControlPlaneError("BUDGET_EXCEEDED", "NEGATIVE_RESOURCE_REQUEST");
    }
    if (r.inputTokens > envelope.tokenBudget.inputMax || r.outputTokens > envelope.tokenBudget.outputMax || r.inputTokens + r.outputTokens > envelope.tokenBudget.totalMax) throw new ControlPlaneError("BUDGET_EXCEEDED", "TOKEN_RESERVATION_EXCEEDS_CAP");
    if (r.cpuMillicoresMs > envelope.computeBudget.cpuMillicores * envelope.latencyBudget.executionTimeoutMs) throw new ControlPlaneError("BUDGET_EXCEEDED", "CPU_RESERVATION_EXCEEDS_ENVELOPE");
    if (r.memoryBytes > envelope.computeBudget.memoryBytes) throw new ControlPlaneError("BUDGET_EXCEEDED", "MEMORY_RESERVATION_EXCEEDS_ENVELOPE");
    if (r.gpuMillicoresMs > envelope.computeBudget.gpuMillicores * envelope.latencyBudget.executionTimeoutMs) throw new ControlPlaneError("BUDGET_EXCEEDED", "GPU_RESERVATION_EXCEEDS_ENVELOPE");
    if (r.diskWriteBytes > envelope.computeBudget.diskWriteBytesMax || r.networkEgressBytes > envelope.computeBudget.networkEgressBytesMax) throw new ControlPlaneError("BUDGET_EXCEEDED", "IO_RESERVATION_EXCEEDS_ENVELOPE");
    if (r.wallClockMs > envelope.latencyBudget.executionTimeoutMs) throw new ControlPlaneError("BUDGET_EXCEEDED", "LATENCY_RESERVATION_EXCEEDS_ENVELOPE");
  }

  private ensureCumulativeReservationWithinEnvelope(e: ResourceEnvelope, r: ResourceUsage): void {
    if (r.inputTokens > e.tokenBudget.inputMax || r.outputTokens > e.tokenBudget.outputMax || r.inputTokens + r.outputTokens > e.tokenBudget.totalMax) throw new ControlPlaneError("BUDGET_EXCEEDED", "AGGREGATE_TOKEN_RESERVATION_EXCEEDS_CAP");
    if (r.memoryBytesPeak > e.computeBudget.memoryBytes || r.cpuMillicoresMs > e.computeBudget.cpuMillicores * e.latencyBudget.executionTimeoutMs || r.gpuMillicoresMs > e.computeBudget.gpuMillicores * e.latencyBudget.executionTimeoutMs || r.diskWriteBytes > e.computeBudget.diskWriteBytesMax || r.networkEgressBytes > e.computeBudget.networkEgressBytesMax) throw new ControlPlaneError("BUDGET_EXCEEDED", "AGGREGATE_COMPUTE_RESERVATION_EXCEEDS_CAP");
  }

  private ensureUsageWithinReservation(r: ResourceReservation, u: ResourceUsage): void {
    if (u.inputTokens > r.inputTokens || u.outputTokens > r.outputTokens || u.cpuMillicoresMs > r.cpuMillicoresMs || u.memoryBytesPeak > r.memoryBytes || u.gpuMillicoresMs > r.gpuMillicoresMs || u.diskWriteBytes > r.diskWriteBytes || u.networkEgressBytes > r.networkEgressBytes || u.wallClockMs > r.wallClockMs) {
      throw new ControlPlaneError("BUDGET_EXCEEDED", "SETTLEMENT_EXCEEDS_RESERVATION");
    }
  }

  private ensureCumulativeUsageWithinEnvelope(e: ResourceEnvelope, u: ResourceUsage): void {
    if (u.inputTokens + u.outputTokens > e.tokenBudget.totalMax || u.inputTokens > e.tokenBudget.inputMax || u.outputTokens > e.tokenBudget.outputMax) throw new ControlPlaneError("BUDGET_EXCEEDED", "CUMULATIVE_TOKEN_CAP_EXCEEDED");
    if (u.memoryBytesPeak > e.computeBudget.memoryBytes || u.cpuMillicoresMs > e.computeBudget.cpuMillicores * e.latencyBudget.executionTimeoutMs || u.gpuMillicoresMs > e.computeBudget.gpuMillicores * e.latencyBudget.executionTimeoutMs || u.diskWriteBytes > e.computeBudget.diskWriteBytesMax || u.networkEgressBytes > e.computeBudget.networkEgressBytesMax || u.wallClockMs > e.latencyBudget.executionTimeoutMs) throw new ControlPlaneError("BUDGET_EXCEEDED", "CUMULATIVE_COMPUTE_CAP_EXCEEDED");
  }
}

function serializeBudget<T extends object>(budget: T): object {
  return JSON.parse(JSON.stringify(budget, (_, value) => typeof value === "bigint" ? `${value}n` : value)) as object;
}

function zeroUsage(): ResourceUsage {
  return { inputTokens: 0n, outputTokens: 0n, cpuMillicoresMs: 0, memoryBytesPeak: 0n, gpuMillicoresMs: 0, diskWriteBytes: 0n, networkEgressBytes: 0n, wallClockMs: 0 };
}

function addUsage(a: ResourceUsage, b: ResourceUsage): ResourceUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cpuMillicoresMs: a.cpuMillicoresMs + b.cpuMillicoresMs,
    memoryBytesPeak: a.memoryBytesPeak > b.memoryBytesPeak ? a.memoryBytesPeak : b.memoryBytesPeak,
    gpuMillicoresMs: a.gpuMillicoresMs + b.gpuMillicoresMs,
    diskWriteBytes: a.diskWriteBytes + b.diskWriteBytes,
    networkEgressBytes: a.networkEgressBytes + b.networkEgressBytes,
    wallClockMs: a.wallClockMs + b.wallClockMs,
  };
}

function addReservable(current: ResourceUsage, next: Omit<ResourceReservation, "committed">): ResourceUsage {
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    cpuMillicoresMs: current.cpuMillicoresMs + next.cpuMillicoresMs,
    memoryBytesPeak: current.memoryBytesPeak + next.memoryBytes,
    gpuMillicoresMs: current.gpuMillicoresMs + next.gpuMillicoresMs,
    diskWriteBytes: current.diskWriteBytes + next.diskWriteBytes,
    networkEgressBytes: current.networkEgressBytes + next.networkEgressBytes,
    wallClockMs: current.wallClockMs,
  };
}

function subtractReservation(current: ResourceUsage, reservation: ResourceReservation): ResourceUsage {
  return {
    inputTokens: current.inputTokens - reservation.inputTokens,
    outputTokens: current.outputTokens - reservation.outputTokens,
    cpuMillicoresMs: current.cpuMillicoresMs - reservation.cpuMillicoresMs,
    memoryBytesPeak: current.memoryBytesPeak - reservation.memoryBytes,
    gpuMillicoresMs: current.gpuMillicoresMs - reservation.gpuMillicoresMs,
    diskWriteBytes: current.diskWriteBytes - reservation.diskWriteBytes,
    networkEgressBytes: current.networkEgressBytes - reservation.networkEgressBytes,
    wallClockMs: current.wallClockMs,
  };
}
