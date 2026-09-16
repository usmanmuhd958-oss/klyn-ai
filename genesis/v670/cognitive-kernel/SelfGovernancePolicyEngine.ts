export class SelfGovernancePolicyEngine {
  evaluate(policy:any){
    return {
      policy,
      status:"validated"
    };
  }
}
