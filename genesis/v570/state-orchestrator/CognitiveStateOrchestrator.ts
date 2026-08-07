export class CognitiveStateOrchestrator {
  coordinate(states:any[]){
    return {
      states,
      unified:true
    };
  }
}
