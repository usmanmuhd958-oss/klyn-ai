import type { DagRunResult, DagTaskNode, DagTaskState, StaleRevisionReplanner, AgentTaskContext } from "./contracts.js";

const isStaleRevision = (error: unknown): boolean =>
  error instanceof Error && /Stale file revision|stale revision|revision mismatch/i.test(error.message);

export interface AgentDAGSchedulerOptions {
  readonly maxConcurrency?: number;
  readonly replanOnStaleRevision?: StaleRevisionReplanner;
}

export class AgentDAGScheduler {
  private readonly maxConcurrency: number;
  private readonly replanOnStaleRevision?: StaleRevisionReplanner;

  constructor(options: AgentDAGSchedulerOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 4;
    if (!Number.isInteger(this.maxConcurrency) || this.maxConcurrency <= 0) {
      throw new RangeError("maxConcurrency must be a positive integer");
    }
    this.replanOnStaleRevision = options.replanOnStaleRevision;
  }

  async run(input: {
    readonly runId: string;
    readonly intentId: string;
    readonly nodes: readonly DagTaskNode[];
  }): Promise<DagRunResult> {
    const nodes = [...input.nodes].sort((left, right) => left.id.localeCompare(right.id));
    this.validate(nodes);
    const state = new Map<string, DagTaskState>(nodes.map((node) => [node.id, { id: node.id, status: "pending", attempts: 0 }]));

    while (true) {
      const ready = nodes.filter((node) => {
        const current = state.get(node.id);
        if (!current || current.status !== "pending") return false;
        return node.dependsOn.every((dependency) => state.get(dependency)?.status === "succeeded");
      });

      const blocked = nodes.filter((node) => {
        const current = state.get(node.id);
        if (!current || current.status !== "pending") return false;
        return node.dependsOn.some((dependency) => {
          const dependencyState = state.get(dependency);
          return dependencyState?.status === "failed" || dependencyState?.status === "blocked";
        });
      });

      for (const node of blocked) {
        state.set(node.id, { ...state.get(node.id)!, status: "blocked" });
      }

      if (ready.length === 0) {
        const terminal = nodes.every((node) => {
          const status = state.get(node.id)?.status;
          return status === "succeeded" || status === "failed" || status === "blocked";
        });
        if (terminal) break;
        throw new Error("DAG scheduler reached a non-terminal state; graph may contain a cycle");
      }

      for (let index = 0; index < ready.length; index += this.maxConcurrency) {
        const batch = ready.slice(index, index + this.maxConcurrency);
        batch.forEach((node) => state.set(node.id, { ...state.get(node.id)!, status: "running" }));
        await Promise.all(batch.map(async (node) => {
          const current = state.get(node.id)!;
          const maxRetries = node.maxRetries ?? 2;
          let attempt = current.attempts;
          while (true) {
            attempt += 1;
            const context: AgentTaskContext = {
              runId: input.runId,
              agentId: node.agentId,
              intentId: input.intentId,
              role: node.role,
            };
            try {
              await node.run(context, attempt);
              state.set(node.id, { id: node.id, status: "succeeded", attempts: attempt });
              return;
            } catch (error) {
              if (isStaleRevision(error) && attempt <= maxRetries) {
                if (this.replanOnStaleRevision) {
                  await this.replanOnStaleRevision({
                    runId: input.runId,
                    node,
                    attempt,
                    error: error instanceof Error ? error : new Error(String(error)),
                  });
                }
                continue;
              }
              state.set(node.id, {
                id: node.id,
                status: "failed",
                attempts: attempt,
                error: error instanceof Error ? error.message : String(error),
              });
              return;
            }
          }
        }));
      }
    }

    const states = nodes.map((node) => ({ ...state.get(node.id)! }));
    return Object.freeze({
      states,
      completed: states.every((entry) => entry.status === "succeeded"),
    });
  }

  private validate(nodes: readonly DagTaskNode[]): void {
    const ids = new Set<string>();
    for (const node of nodes) {
      if (!node.id || ids.has(node.id)) throw new Error(`Duplicate or empty DAG node id: ${node.id}`);
      ids.add(node.id);
    }
    for (const node of nodes) {
      for (const dependency of node.dependsOn) {
        if (!ids.has(dependency)) throw new Error(`Unknown DAG dependency: ${node.id} -> ${dependency}`);
      }
    }
  }
}
