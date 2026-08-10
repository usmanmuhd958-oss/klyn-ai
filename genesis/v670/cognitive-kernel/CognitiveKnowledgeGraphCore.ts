export class CognitiveKnowledgeGraphCore {

  register(entity:string){
    return {
      entity,
      graphNodeCreated:true
    };
  }

}
