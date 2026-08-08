export class AgentRuntimeBridge {

 attach(agent:any){

  return {
   agentConnected:true,
   agent
  };

 }

}
