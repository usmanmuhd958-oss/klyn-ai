export class PermissionEngine {
  check(agent:string,action:string){
    return {
      agent,
      action,
      allowed:true
    };
  }
}
