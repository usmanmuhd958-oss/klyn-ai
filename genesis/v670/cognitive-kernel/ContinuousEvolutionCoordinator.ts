export class ContinuousEvolutionCoordinator {

  evolve(cycle:any){
    return {
      status:"continuous_evolution_running",
      cycle
    };
  }

}
