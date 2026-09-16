export interface ContextSnapshot<T = unknown> {
  readonly executionId: string;
  readonly revision: number;
  readonly timestamp: number;
  readonly parentRevision: number | null;
  readonly value: Readonly<T>;
}

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (current: unknown): void => {
    if (!current || typeof current !== "object" || Object.isFrozen(current)) return;
    Object.freeze(current);
    for (const child of Object.values(current as Record<string, unknown>)) freeze(child);
  };
  freeze(cloned);
  return cloned;
}

export class ContextStore<T = unknown> {
  private readonly snapshots = new Map<string, ContextSnapshot<T>[]>();

  snapshot(executionId: string, value: T): ContextSnapshot<T> {
    const history = this.snapshots.get(executionId) ?? [];
    const previous = history.at(-1) ?? null;
    const snapshot: ContextSnapshot<T> = Object.freeze({
      executionId,
      revision: history.length + 1,
      timestamp: Date.now(),
      parentRevision: previous?.revision ?? null,
      value: cloneAndFreeze(value) as Readonly<T>,
    });
    history.push(snapshot);
    this.snapshots.set(executionId, history);
    return snapshot;
  }

  latest(executionId: string): ContextSnapshot<T> | undefined {
    return this.snapshots.get(executionId)?.at(-1);
  }

  get(executionId: string, revision: number): ContextSnapshot<T> | undefined {
    return this.snapshots.get(executionId)?.find((snapshot) => snapshot.revision === revision);
  }

  history(executionId: string): readonly ContextSnapshot<T>[] {
    return Object.freeze([...(this.snapshots.get(executionId) ?? [])]);
  }

  clear(executionId: string): void {
    this.snapshots.delete(executionId);
  }
}
