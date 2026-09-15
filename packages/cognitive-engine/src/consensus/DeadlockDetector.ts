export interface DependencyEdge {
  readonly waiter: string;
  readonly holder: string;
  readonly resource?: string;
}

export interface DeadlockCycle {
  readonly participants: readonly string[];
  readonly edges: readonly DependencyEdge[];
}

/** Detects cyclic waits using deterministic DFS over a wait-for graph. */
export class DeadlockDetector {
  detect(edges: readonly DependencyEdge[]): readonly DeadlockCycle[] {
    const graph = new Map<string, DependencyEdge[]>();
    for (const edge of edges) {
      if (!edge.waiter.trim() || !edge.holder.trim()) throw new Error("Dependency endpoints must not be empty");
      const list = graph.get(edge.waiter) ?? [];
      list.push(edge);
      graph.set(edge.waiter, list);
    }
    for (const list of graph.values()) list.sort((a, b) => a.holder.localeCompare(b.holder) || (a.resource ?? "").localeCompare(b.resource ?? ""));

    const cycles: DeadlockCycle[] = [];
    const seen = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];
    const visit = (node: string): void => {
      if (stack.has(node)) {
        const start = path.indexOf(node);
        if (start >= 0) {
          const participants = path.slice(start);
          const keys = new Set(participants.map((p) => `${p}->`));
          const cycleEdges = edges.filter((e) => keys.has(`${e.waiter}->`) && participants.includes(e.holder));
          const signature = participants.slice().sort().join("|");
          if (!seen.has(signature)) {
            seen.add(signature);
            cycles.push(Object.freeze({ participants: Object.freeze(participants.slice()), edges: Object.freeze(cycleEdges.slice()) }));
          }
        }
        return;
      }
      if (path.includes(node)) return;
      stack.add(node); path.push(node);
      for (const edge of graph.get(node) ?? []) visit(edge.holder);
      path.pop(); stack.delete(node);
    };
    for (const node of [...graph.keys()].sort()) visit(node);
    return Object.freeze(cycles);
  }
}
