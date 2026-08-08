export class PolicyEngine {
  evaluate(policy:string){
    return {
      policy,
      approved:true
    };
  }
}
