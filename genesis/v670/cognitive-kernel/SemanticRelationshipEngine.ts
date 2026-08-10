export class SemanticRelationshipEngine {

  connect(source:string,target:string){
    return {
      source,
      target,
      relationshipCreated:true
    };
  }

}
