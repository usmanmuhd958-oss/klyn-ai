export class AgentCommunicationFabric {

 send(agent:any,message:any){

  return {
   delivered:true,
   agent,
   message
  };

 }

}
