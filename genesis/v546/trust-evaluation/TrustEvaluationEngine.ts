export class TrustEvaluationEngine {
  evaluate(agent:string){
    return {
      agent,
      trustScore:100
    };
  }
}
