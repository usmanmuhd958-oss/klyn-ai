export class EngineeringKnowledgeGraphMemoryEngine {
  retrieve(query:any){
    return {
      query,
      knowledge:[]
    };
  }
}
