import { AgentProfile } from "./AgentProfile";


export class AgentRegistry {


 private agents:AgentProfile[]=[];


 register(agent:AgentProfile){

   this.agents.push(agent);

 }


 find(role:string){

   return this.agents.filter(
     a=>a.role===role
   );

 }


 list(){

   return this.agents;

 }


}
