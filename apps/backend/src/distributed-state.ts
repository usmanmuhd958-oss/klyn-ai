export interface RevisionedContextSnapshot<T = unknown> {
  readonly executionId: string;
  readonly revision: number;
  readonly timestamp: number;
  readonly nodeId: string;
  readonly value: Readonly<T>;
}

export interface SnapshotHistory<T = unknown> {
  readonly executionId: string;
  readonly snapshots: readonly RevisionedContextSnapshot<T>[];
}

export interface StateSnapshotSource<T = unknown> {
  history(executionId: string): readonly RevisionedContextSnapshot<T>[];
}

export interface RehydratedState<T = unknown> {
  readonly executionId: string;
  readonly revision: number;
  readonly sourceNodeId: string;
  readonly value: Readonly<T>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Reconstructs the newest contiguous revision of an execution after node failure. */
export class ClusterStateRehydrator<T = unknown> {
  constructor(private readonly source: StateSnapshotSource<T>) {}

  rehydrate(executionId: string, minimumRevision = 1): RehydratedState<T> | undefined {
    const history = [...this.source.history(executionId)].sort((a, b) => a.revision - b.revision);
    if (history.length === 0) return undefined;
    let expected = minimumRevision;
    let selected: RevisionedContextSnapshot<T> | undefined;
    for (const snapshot of history) {
      if (snapshot.revision < expected) continue;
      if (snapshot.revision !== expected) throw new Error(`Non-contiguous context history for ${executionId}: expected revision ${expected}, received ${snapshot.revision}`);
      selected = snapshot;
      expected += 1;
    }
    if (!selected) return undefined;
    return Object.freeze({
      executionId,
      revision: selected.revision,
      sourceNodeId: selected.nodeId,
      value: clone(selected.value),
    });
  }

  latest(executionId: string): RehydratedState<T> | undefined {
    const history = [...this.source.history(executionId)].sort((a, b) => b.revision - a.revision);
    const selected = history[0];
    if (!selected) return undefined;
    return Object.freeze({ executionId, revision: selected.revision, sourceNodeId: selected.nodeId, value: clone(selected.value) });
  }
}
