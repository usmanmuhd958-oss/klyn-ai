export class AgentNodeCommunicationProtocol {
  send(message:any){
    return {
      message,
      delivered:true
    };
  }
}
