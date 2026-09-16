export class CognitivePolicyEnforcementEngine {
  enforce(policy:any){
    return {
      policy,
      enforced:true
    };
  }
}
