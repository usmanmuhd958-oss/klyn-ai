export class KernelEvolutionMemory {

  store(evolution:any){
    return {
      status:"evolution_memory_saved",
      evolution
    };
  }

}
