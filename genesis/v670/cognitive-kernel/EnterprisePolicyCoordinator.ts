export class EnterprisePolicyCoordinator {

  enforce(policy:any){
    return {
      status:"policy_enforced",
      policy
    };
  }

}
