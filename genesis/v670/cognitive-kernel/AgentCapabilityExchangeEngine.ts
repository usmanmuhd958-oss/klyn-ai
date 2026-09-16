export class AgentCapabilityExchangeEngine {

  exchange(agent:string){
    return {
      agent,
      capability:"shared"
    };
  }

}
