import type { ContextNode, ContextProjection, EventId, MissionId } from "./types.js";

export class ContextLocalityManager {
  project(missionId: MissionId, nodes: readonly ContextNode[], tokenBudget: number): ContextProjection {
    if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) throw new Error("INVALID_CONTEXT_TOKEN_BUDGET");
    this.validateTopology(nodes);
    const originalTokenEstimate = nodes.reduce((sum, node) => sum + node.tokenCost, 0);
    const critical = nodes.filter((node) => node.critical).sort(byImportanceDesc);
    const nonCritical = nodes.filter((node) => !node.critical).sort(byImportanceDesc);

    const selected: ContextNode[] = [];
    const omitted: string[] = [];
    let retained = 0;

    for (const node of [...critical, ...nonCritical]) {
      const projectedCost = node.layer === "L2" ? Math.min(node.tokenCost, 12) : Math.min(node.tokenCost, 512);
      if (retained + projectedCost <= tokenBudget) {
        selected.push(node);
        retained += projectedCost;
      } else {
        omitted.push(node.nodeId);
      }
    }

    const criticalNodeIds = new Set(critical.map((node) => node.nodeId));
    const criticalOmitted = omitted.some((id) => criticalNodeIds.has(id));
    return Object.freeze({
      missionId,
      nodes: Object.freeze(selected),
      omittedNodeIds: Object.freeze(omitted),
      retainedTokenEstimate: retained,
      originalTokenEstimate,
      reductionRatio: originalTokenEstimate === 0 ? 0 : Math.max(0, 1 - retained / originalTokenEstimate),
      losslessForCriticalState: !criticalOmitted && selected.every((node) => node.sourceEventIds.length > 0 || node.layer === "L0"),
    });
  }

  validateTopology(nodes: readonly ContextNode[]): void {
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    for (const node of nodes) {
      for (const parent of node.parents) {
        if (!byId.has(parent)) throw new Error(`CONTEXT_PARENT_NOT_FOUND:${node.nodeId}:${parent}`);
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`CONTEXT_CYCLE_DETECTED:${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const parent of byId.get(id)!.parents) visit(parent);
      visiting.delete(id);
      visited.add(id);
    };
    for (const node of nodes) visit(node.nodeId);
  }

  handoff(nodes: readonly ContextNode[], requiredEventIds: readonly EventId[]): readonly ContextNode[] {
    const required = new Set(requiredEventIds);
    return Object.freeze(nodes.filter((node) => node.sourceEventIds.some((eventId) => required.has(eventId)) || node.critical));
  }
}

function byImportanceDesc(a: ContextNode, b: ContextNode): number {
  if (a.critical !== b.critical) return a.critical ? -1 : 1;
  return b.importance - a.importance;
}
