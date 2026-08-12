import { GraphNode } from "./GraphNode.js";
import { GraphEdge } from "./GraphEdge.js";

export class CodeGraph {
  private nodes: Map<string, GraphNode>;
  private edges: Map<string, GraphEdge>;

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, edge);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getDependencies(nodeId: string): GraphNode[] {
    const dependencies: GraphNode[] = [];

    for (const edge of this.edges.values()) {
      if (
        edge.source === nodeId &&
        edge.type === "depends-on"
      ) {
        const target = this.nodes.get(edge.target);

        if (target) {
          dependencies.push(target);
        }
      }
    }

    return dependencies;
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }
}
