export class PolicyIntelligenceEngine {
  enforce(policy:string){
    return {
      policy,
      enforced:true
    };
  }
}
