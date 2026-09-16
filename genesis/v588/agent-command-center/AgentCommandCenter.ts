export class AgentCommandCenter {

 private agents:string[]=[];


 register(agent:string){

   this.agents.push(agent);

 }


 list(){

   return this.agents;

 }


 dispatch(task:any){

   return {
     dispatched:true,
     task,
     agents:this.agents
   };

 }

}
