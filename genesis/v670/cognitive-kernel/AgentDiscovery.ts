export class AgentDiscovery {

  discover(network:any[]){
    return {
      agents: network,
      count: network.length
    };
  }

}
