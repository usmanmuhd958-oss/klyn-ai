export interface ClusterNode {
  readonly nodeId: string;
  readonly lastHeartbeat: number;
  readonly status: "active" | "suspect" | "evicted";
}

export interface OrphanTask {
  readonly taskId: string;
  readonly nodeId: string;
}

export interface TaskReassigner {
  reassign(taskId: string, fromNodeId: string): Promise<void>;
}

export interface NodeHeartbeatMonitorOptions {
  readonly nodeTimeoutMs?: number;
  readonly evictionGraceMs?: number;
  readonly now?: () => number;
}

/** Tracks node liveness and provides deterministic orphan-task reconciliation after eviction. */
export class NodeHeartbeatMonitor {
  private readonly nodes = new Map<string, ClusterNode>();
  private readonly orphaned = new Set<string>();
  private readonly nodeTimeoutMs: number;
  private readonly evictionGraceMs: number;
  private readonly now: () => number;

  constructor(private readonly reassigner: TaskReassigner, options: NodeHeartbeatMonitorOptions = {}) {
    this.nodeTimeoutMs = options.nodeTimeoutMs ?? 15_000;
    this.evictionGraceMs = options.evictionGraceMs ?? 5_000;
    this.now = options.now ?? Date.now;
    if (this.nodeTimeoutMs <= 0 || this.evictionGraceMs < 0) throw new Error("Invalid heartbeat timing policy");
  }

  join(nodeId: string): void {
    this.assertNodeId(nodeId);
    const now = this.now();
    this.nodes.set(nodeId, { nodeId, lastHeartbeat: now, status: "active" });
  }

  heartbeat(nodeId: string): void {
    this.assertNodeId(nodeId);
    const current = this.nodes.get(nodeId);
    if (!current || current.status === "evicted") {
      this.join(nodeId);
      return;
    }
    this.nodes.set(nodeId, { ...current, lastHeartbeat: this.now(), status: "active" });
  }

  leave(nodeId: string): void {
    const current = this.nodes.get(nodeId);
    if (current) this.nodes.set(nodeId, { ...current, status: "evicted" });
  }

  observe(): readonly string[] {
    const now = this.now();
    const evicted: string[] = [];
    for (const [nodeId, node] of this.nodes) {
      if (node.status === "evicted") continue;
      const age = now - node.lastHeartbeat;
      if (age <= this.nodeTimeoutMs) continue;
      if (age <= this.nodeTimeoutMs + this.evictionGraceMs) {
        this.nodes.set(nodeId, { ...node, status: "suspect" });
        continue;
      }
      this.nodes.set(nodeId, { ...node, status: "evicted" });
      evicted.push(nodeId);
    }
    return Object.freeze(evicted);
  }

  async reconcile(tasks: readonly OrphanTask[]): Promise<readonly string[]> {
    this.observe();
    return this.reassignOrphans(tasks);
  }

  async reassignOrphans(tasks: readonly OrphanTask[]): Promise<readonly string[]> {
    const reassigned: string[] = [];
    for (const task of tasks) {
      const node = this.nodes.get(task.nodeId);
      if (!node || node.status !== "evicted" || this.orphaned.has(task.taskId)) continue;
      this.orphaned.add(task.taskId);
      await this.reassigner.reassign(task.taskId, task.nodeId);
      reassigned.push(task.taskId);
    }
    return Object.freeze(reassigned);
  }

  getNode(nodeId: string): ClusterNode | undefined {
    const node = this.nodes.get(nodeId);
    return node ? Object.freeze({ ...node }) : undefined;
  }

  snapshot(): readonly ClusterNode[] {
    return Object.freeze([...this.nodes.values()].map((node) => Object.freeze({ ...node })));
  }

  private assertNodeId(nodeId: string): void {
    if (!nodeId.trim()) throw new Error("nodeId must not be empty");
  }
}
