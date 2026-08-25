export interface ASTNode {
  id: string;
  type: string;
  name: string;
  children: string[];
}

export class ASTGraph {
  private nodes = new Map<string, ASTNode>();

  addNode(node: ASTNode) {
    this.nodes.set(node.id, node);
  }

  connect(parentId: string, childId: string) {
    const parent = this.nodes.get(parentId);
    if (!parent) return;

    parent.children.push(childId);
  }

  getGraph() {
    return Array.from(this.nodes.values());
  }
}
