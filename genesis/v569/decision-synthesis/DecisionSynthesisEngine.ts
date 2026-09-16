export class DecisionSynthesisEngine {
  synthesize(inputs:any[]){
    return {
      inputs,
      decision:"generated"
    };
  }
}
