export class AgentRegistry {

  private agents:any[]=[];


  register(agent:any){

    this.agents.push(agent);

  }


  list(){

    return this.agents;

  }

}
