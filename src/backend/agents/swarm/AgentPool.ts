export interface AgentInstance {

 id:string;

 capability:string;

 status:"IDLE"|"BUSY";

}


export class AgentPool {

 private agents:AgentInstance[]=[];


 register(agent:AgentInstance){

  this.agents.push(agent);

 }


 available(){

  return this.agents.filter(
   agent=>agent.status==="IDLE"
  );

 }


}
