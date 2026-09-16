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
      name: path.split("/").pop() ?? path,
      type: "file",
      metadata: {
        filePath: path
      },
      createdAt: new Date(),
      updatedAt: new Date()
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
