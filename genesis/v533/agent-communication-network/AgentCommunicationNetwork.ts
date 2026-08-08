export class AgentCommunicationNetwork {
  send(message:any){
    return {
      message,
      delivered:true
    }
  }
}
