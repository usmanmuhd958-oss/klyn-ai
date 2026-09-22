export class SecurityPolicyEngine {

  evaluate(request:any){

    return {
      allowed:true,
      request
    };

  }

}
