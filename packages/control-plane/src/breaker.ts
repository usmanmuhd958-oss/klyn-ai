import { BREAKER_ORDER, type BreakerLevel, type MissionId } from "./types.js";

export interface BreakerSnapshot {
  readonly missionId: MissionId;
  readonly level: BreakerLevel;
  readonly reason: string;
  readonly triggeredAt: string;
}

export class CircuitBreakerEngine {
  private readonly states = new Map<string, BreakerSnapshot>();

  level(missionId: MissionId): BreakerLevel {
    return this.states.get(missionId)?.level ?? "NONE";
  }

  trigger(missionId: MissionId, level: BreakerLevel, reason: string, now: string): BreakerSnapshot {
    if (!reason.trim()) throw new Error("BREAKER_REASON_REQUIRED");
    const current = this.states.get(missionId);
    if (current && BREAKER_ORDER[level] <= BREAKER_ORDER[current.level]) return current;
    const snapshot: BreakerSnapshot = { missionId, level, reason, triggeredAt: now };
    this.states.set(missionId, snapshot);
    return snapshot;
  }

  isBlocked(missionId: MissionId): boolean {
    return this.level(missionId) !== "NONE";
  }

  clear(missionId: MissionId, authorization: string): void {
    if (authorization.length < 16) throw new Error("BREAKER_CLEAR_REQUIRES_STRONG_AUTHORIZATION");
    this.states.delete(missionId);
  }
}
