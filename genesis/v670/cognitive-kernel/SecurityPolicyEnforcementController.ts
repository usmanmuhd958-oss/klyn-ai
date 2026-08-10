export class SecurityPolicyEnforcementController {

  enforce(policy:any){
    return {
      status:"policy_enforcement_active",
      policy
    };
  }

}
