export class AgentLifecycleManager {

 start(agent:string){

  return {
   agent,
   state:"active"
  };

 }

 stop(agent:string){

  return {
   agent,
   state:"terminated"
  };

 }

}
