import { CodeGraphEngine } from "../graph/CodeGraphEngine.js";
import { GraphNode } from "../graph/GraphNode.js";

export interface ImpactReport {
  changedNode: string;
  affectedNodes: GraphNode[];
  riskScore: number;
  timestamp: Date;
}

export class ChangeImpactAnalyzer {

  constructor(
    private graph: CodeGraphEngine
  ) {}

  analyze(
    nodeId: string
  ): ImpactReport {

    const affected =
      this.graph.analyzeDependencies(nodeId);

    const riskScore =
      Math.min(
        affected.length * 10,
        100
      );

    return {
      changedNode: nodeId,
      affectedNodes: affected,
      riskScore,
      timestamp: new Date()
    };
  }

}
