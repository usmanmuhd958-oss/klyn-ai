import { Agent } from "../core/Agent";


export class SwarmEngine {


 private agents:Agent[] = [];


 addAgent(agent:Agent){

   this.agents.push(agent);

 }


 listAgents(){

   return this.agents;

 }


 async coordinate(task:string){

   const results = [];

   for(const agent of this.agents){

     results.push(
       await agent.execute(task)
     );

   }

   return results;

 }


}
