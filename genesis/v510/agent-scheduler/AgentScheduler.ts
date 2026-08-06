export class AgentScheduler {

 schedule(agent:string,task:string){

  return {
   agent,
   task,
   status:"scheduled"
  };

 }

}
