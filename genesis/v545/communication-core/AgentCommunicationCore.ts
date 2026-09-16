export class AgentCommunicationCore {
  send(agent:string,message:string){
    return {
      agent,
      message
    };
  }
}
