export interface AgentTask {

 id:string;

 type:string;

 payload:unknown;

}


export class AgentTaskDistributor {


 distribute(
  task:AgentTask,
  agents:any[]
 ){

  if(!agents.length){

   return {
    assigned:false
   };

  }


  return {

   assigned:true,

   agent:agents[0].id,

   task

  };


 }


}
