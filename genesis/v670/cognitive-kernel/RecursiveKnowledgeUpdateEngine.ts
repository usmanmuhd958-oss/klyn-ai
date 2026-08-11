export class RecursiveKnowledgeUpdateEngine {
  update(knowledge:any){
    return {
      knowledge,
      updated:true
    };
  }
}
