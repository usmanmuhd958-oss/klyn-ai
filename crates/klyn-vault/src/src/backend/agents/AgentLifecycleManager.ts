export class AgentLifecycleManager {


 start(agentId:string){

  return {

   agentId,

   status:"RUNNING"

  };

 }


 stop(agentId:string){

  return {

   agentId,

   status:"STOPPED"

  };

 }


}
