export class AgentPermissionControlManager {
  check(agent:string,permission:string){
    return {
      agent,
      permission,
      allowed:true
    };
  }
}
