export class SharedIntelligenceMemory {
  store(memory:string){
    return {
      memory,
      shared:true
    };
  }
}
