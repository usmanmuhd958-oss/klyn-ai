import { DependencyGraph } from "./DependencyGraph.js";


export type ImpactReport = {
  root: string;
  affectedNodes: string[];
  depth: number;
  severity: "low" | "medium" | "high";
};


export class ImpactGraph {

  constructor(
    private graph: DependencyGraph
  ) {}


  analyze(root: string): ImpactReport {

    const visited = new Set<string>();

    this.walk(root, visited);


    return {
      root,
      affectedNodes: Array.from(visited),
      depth: visited.size,
      severity: this.calculateSeverity(
        visited.size
      )
    };
  }


  private walk(
    node: string,
    visited: Set<string>
  ) {

    if (visited.has(node)) {
      return;
    }


    visited.add(node);


    const dependents =
      this.graph.getDependents(node);


    for (const relation of dependents) {

      this.walk(
        relation.source,
        visited
      );

    }
  }


  private calculateSeverity(
    size: number
  ): "low" | "medium" | "high" {

    if (size > 20) return "high";

    if (size > 5) return "medium";

    return "low";
  }
}
