import type { DeadlockCycle } from "./DeadlockDetector.js";

export interface RecoveryState<T = unknown> {
  readonly revision: number;
  readonly value: T;
}

export interface RecoveryHooks<T = unknown> {
  evictLock: (agentId: string) => Promise<void> | void;
  rewind: (state: RecoveryState<T>) => Promise<void> | void;
}

export interface RecoveryResult {
  readonly victim: string;
  readonly released: readonly string[];
  readonly rewound: boolean;
}

/** Breaks a detected cycle deterministically and rewinds to a caller-supplied safe revision. */
export class SelfHealingStateResolver<T = unknown> {
  constructor(private readonly hooks: RecoveryHooks<T>) {}

  async resolve(cycle: DeadlockCycle, safeState: RecoveryState<T>): Promise<RecoveryResult> {
    if (cycle.participants.length < 2) throw new Error("Deadlock cycle must contain at least two participants");
    const participants = cycle.participants.slice().sort();
    const victim = participants[participants.length - 1];
    await this.hooks.evictLock(victim);
    await this.hooks.rewind({ revision: safeState.revision, value: structuredClone(safeState.value) });
    return Object.freeze({ victim, released: Object.freeze([victim]), rewound: true });
  }
}
