import { CodeGraphEngine } from "../graph/CodeGraphEngine.js";
import { GraphNode } from "../graph/GraphNode.js";

export class ImpactEngine {

  constructor(
    private graph: CodeGraphEngine
  ) {}

  analyzeChange(nodeId: string): GraphNode[] {

    return this.graph.analyzeDependencies(nodeId);

  }

}
