export class CognitivePolicyDecisionEngine {

  evaluate(policy:string){
    return {
      policy,
      decision:"approved"
    };
  }

}
