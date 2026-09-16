export class AgentLifecycleManagementEngine {
  manage(agent:any){
    return {
      lifecycle:"managed",
      agent
    };
  }
}
