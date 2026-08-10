export class DecisionEngine {

  decide(input:any){
    return {
      decision:"execute",
      confidence:0.95,
      input
    };
  }

}
