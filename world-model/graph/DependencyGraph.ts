export type DependencyRelation = {
  source: string;
  target: string;
  type: 
    | "imports"
    | "calls"
    | "extends"
    | "depends_on";
};


export class DependencyGraph {

  private relations: DependencyRelation[] = [];


  addRelation(relation: DependencyRelation) {
    this.relations.push(relation);
  }


  getDependencies(node: string) {
    return this.relations.filter(
      r => r.source === node
    );
  }


  getDependents(node: string) {
    return this.relations.filter(
      r => r.target === node
    );
  }


  get relationCount() {
    return this.relations.length;
  }


  get allRelations() {
    return [...this.relations];
  }


  analyzeImpact(node: string) {

    return {
      node,
      affected: this.getDependents(node),
      risk:
        this.getDependents(node).length > 10
          ? "high"
          : "normal"
    };
  }
}
