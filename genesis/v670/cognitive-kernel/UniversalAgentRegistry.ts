export class UniversalAgentRegistry {

  register(agent:any){
    return {
      status:"agent_registered",
      agent
    };
  }

}
