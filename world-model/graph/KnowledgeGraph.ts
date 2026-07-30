export type KnowledgeNode = {
  id: string;
  type: string;
  name: string;
  metadata: Record<string, unknown>;
};


export type KnowledgeEdge = {
  from: string;
  to: string;
  relation: string;
};


export class KnowledgeGraph {

  private nodes = new Map<string, KnowledgeNode>();
  private edges: KnowledgeEdge[] = [];


  addNode(node: KnowledgeNode) {
    this.nodes.set(node.id, node);
  }


  connect(edge: KnowledgeEdge) {
    this.edges.push(edge);
  }


  getNode(id: string) {
    return this.nodes.get(id);
  }


  findRelated(id: string) {
    return this.edges.filter(
      e => e.from === id || e.to === id
    );
  }
}
