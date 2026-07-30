export interface KnowledgeNode {
  id: string;
  concept: string;
  information: string;
  relations: string[];
}

export class SemanticMemory {

  private knowledge: KnowledgeNode[] = [];

  learn(node: KnowledgeNode) {
    this.knowledge.push(node);
  }

  search(concept: string) {
    return this.knowledge.filter(item =>
      item.concept.includes(concept)
    );
  }

}
