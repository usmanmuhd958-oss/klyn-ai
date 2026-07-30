export interface ReasoningNode {
  id: string;
  thought: string;
  connections: string[];
}

export class ReasoningGraph {
  private nodes: Map<string, ReasoningNode>;

  constructor() {
    this.nodes = new Map();
  }

  addNode(node: ReasoningNode) {
    this.nodes.set(node.id, node);
  }

  connect(from: string, to: string) {
    const node = this.nodes.get(from);

    if (node) {
      node.connections.push(to);
    }
  }

  getGraph() {
    return Array.from(this.nodes.values());
  }
}
