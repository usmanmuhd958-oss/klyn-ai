export class AgentCommunicationNetwork {

 send(from:string,to:string,message:string){

  return {
   from,
   to,
   message,
   delivered:true
  };

 }

}
