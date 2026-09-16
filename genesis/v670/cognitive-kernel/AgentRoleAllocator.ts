export class AgentRoleAllocator {
  allocate(agent:string, role:string){
    return {
      agent,
      role,
      status:"assigned"
    };
  }
}
