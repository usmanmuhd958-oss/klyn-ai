export class IntelligenceGovernancePolicyEngine {
  enforce(policy:any){
    return {
      policy,
      enforcement:"active"
    };
  }
}
