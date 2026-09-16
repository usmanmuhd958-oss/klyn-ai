export class AgentMarketplace {

  private agents:any[]=[];

  publish(agent:any){
    this.agents.push(agent);
    return {
      published:true,
      agent
    };
  }

  list(){
    return this.agents;
  }

}
