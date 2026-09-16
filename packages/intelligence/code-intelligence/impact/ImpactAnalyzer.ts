import { ImpactNode } from "./ImpactNode.js";

export class ImpactAnalyzer {

  analyze(
    changedNode: string,
    dependencies: string[]
  ): ImpactNode {

    const riskScore =
      Math.min(
        dependencies.length * 10,
        100
      );

    return {
      id: crypto.randomUUID(),
      type: "file-change",
      name: changedNode,
      affectedNodes: dependencies,
      riskScore
    };
  }

}
