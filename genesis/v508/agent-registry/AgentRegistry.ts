export class AgentRegistry {

 agents:any[]=[];

 register(agent:any){

  this.agents.push(agent);

  return {
   status:"agent registered",
   agent
  };

 }

 list(){

  return this.agents;

 }

}
