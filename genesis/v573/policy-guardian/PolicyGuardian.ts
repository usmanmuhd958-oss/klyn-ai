export class PolicyGuardian {
  enforce(policy:any){
    return {
      policy,
      enforced:true
    };
  }
}
