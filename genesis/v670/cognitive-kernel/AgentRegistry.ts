import { AgentRuntime }
from "./AgentRuntime";


export class AgentRegistry {

 private agents =
   new Map<string,AgentRuntime>();


 register(
  id:string,
  agent:AgentRuntime
 ){

  this.agents.set(id,agent);

 }


 get(id:string){

  return this.agents.get(id);

 }


 list(){

  return [
   ...this.agents.keys()
  ];

 }

}
