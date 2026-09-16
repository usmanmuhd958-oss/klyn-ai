export class AgentCommunicationBus {
  publish(event:string){
    return {
      event,
      status:"published"
    };
  }
}
