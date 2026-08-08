export class AgentIdentitySystem {
  create(agent:string){
    return {
      id: agent,
      active:true
    };
  }
}
