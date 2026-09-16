export class KnowledgeEvolutionMemoryController {

  evolve(memory:any){
    return {
      memory,
      evolutionRecorded:true
    };
  }

}
