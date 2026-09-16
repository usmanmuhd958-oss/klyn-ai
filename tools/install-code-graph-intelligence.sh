#!/data/data/com.termux/files/usr/bin/bash

set -e

BASE="packages/intelligence/code-intelligence"

mkdir -p "$BASE/graph"

cat > "$BASE/graph/CodeGraphEngine.ts" <<'TS'
import { CodeGraph } from "./CodeGraph.js";
import { GraphNode } from "./GraphNode.js";
import { GraphEdge } from "./GraphEdge.js";

export class CodeGraphEngine {

  private graph: CodeGraph;

  constructor() {
    this.graph = new CodeGraph();
  }


  registerFile(
    id: string,
    path: string
  ): void {

    const node: GraphNode = {
      id,
      type: "file",
      metadata: {
        path
      }
    };

    this.graph.addNode(node);
  }


  registerDependency(
    id: string,
    source: string,
    target: string
  ): void {

    const edge: GraphEdge = {
      id,
      source,
      target,
      type: "depends-on"
    };

    this.graph.addEdge(edge);
  }


  analyzeDependencies(
    nodeId:string
  ): GraphNode[] {

    return this.graph.getDependencies(nodeId);

  }


  snapshot(){

    return {
      nodes:this.graph.getAllNodes(),
      edges:this.graph.getAllEdges()
    };

  }

}
TS


echo "✅ Code Intelligence Graph Engine installed"

