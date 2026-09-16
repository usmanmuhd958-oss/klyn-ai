export class PolicyEngine {

  validate(action:any){
    return {
      allowed:true,
      action
    };
  }

}
