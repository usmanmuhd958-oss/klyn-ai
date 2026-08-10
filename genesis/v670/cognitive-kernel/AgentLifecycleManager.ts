export class AgentLifecycleManager {

  activate(agent:string){
    return {
      agent,
      status:"active"
    };
  }

  deactivate(agent:string){
    return {
      agent,
      status:"inactive"
    };
  }

}
