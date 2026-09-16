export class SwarmDecisionCoordinationEngine {
  decide(inputs:any[]){
    return {
      decision:"coordinated",
      inputs
    };
  }
}
