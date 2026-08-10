export class EnterpriseSecurityPolicyController {

  enforce(policy:any){
    return {
      status:"security_policy_enforced",
      policy
    };
  }

}
