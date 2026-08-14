
import type {
 AgentIdentity
} from "./agent.types";


export class AgentRegistry {

 private agents =
 new Map<string,AgentIdentity>();


 register(
 agent:AgentIdentity
 ){

 this.agents.set(
  agent.id,
  agent
 );

 }


 get(id:string){

 return this.agents.get(id);

 }


 list(){

 return Array.from(
 this.agents.values()
 );

 }

}


export const agentRegistry =
new AgentRegistry();


