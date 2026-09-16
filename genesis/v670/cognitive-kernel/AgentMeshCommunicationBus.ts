export class AgentMeshCommunicationBus {

  broadcast(message:string){
    return {
      status:"distributed",
      message
    };
  }

}
