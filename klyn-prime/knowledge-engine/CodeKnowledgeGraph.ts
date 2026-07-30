export interface CodeNode {
  name: string;
  type: string;
}


export class CodeKnowledgeGraph {

  private nodes: CodeNode[] = [];


  add(node: CodeNode) {
    this.nodes.push(node);
  }


  getGraph() {
    return this.nodes;
  }

}
