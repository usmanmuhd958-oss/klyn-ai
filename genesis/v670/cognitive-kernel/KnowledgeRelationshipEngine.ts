export class KnowledgeRelationshipEngine {
  relate(source:string,target:string){
    return {
      status:"related",
      source,
      target
    };
  }
}
