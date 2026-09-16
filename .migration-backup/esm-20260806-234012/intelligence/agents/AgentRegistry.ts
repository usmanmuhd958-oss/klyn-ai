import {Agent} from "./Agent";

export class AgentRegistry {

 private agents =
 new Map<string, Agent>();

 register(agent: Agent){
   this.agents.set(
     agent.id,
     agent
   );
 }


 get(id:string){
   return this.agents.get(id);
 }


 list(){
   return [...this.agents.values()];
 }

}
