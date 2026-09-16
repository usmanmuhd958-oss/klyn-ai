export class SemanticKnowledgeIndex {
  index(value:string){
    return {
      status:"indexed",
      value
    };
  }
}
