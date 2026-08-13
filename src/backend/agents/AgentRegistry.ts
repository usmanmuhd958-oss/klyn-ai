import {AgentIdentity} from "./AgentIdentity.js";


export class AgentRegistry {

 private agents:AgentIdentity[]=[];


 register(agent:AgentIdentity){

  this.agents.push(agent);

  return agent;

 }


 list(){

  return this.agents;

 }

}
