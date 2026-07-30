import { Agent } from "./Agent";


export class AgentSwarm {


  private agents:Agent[] = [];


  register(agent:Agent){

    this.agents.push(agent);

  }


  broadcast(task:string){

    return this.agents.map(agent =>
      agent.execute(task)
    );

  }


  list(){

    return this.agents;

  }

}
