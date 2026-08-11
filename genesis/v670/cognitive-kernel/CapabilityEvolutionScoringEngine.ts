export class CapabilityEvolutionScoringEngine {
  score(capability:any){
    return {
      capability,
      score:"calculated"
    };
  }
}
