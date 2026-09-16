export class AgentCapabilityRoutingIntelligence {
  route(task:any){
    return {
      task,
      agent:"selected"
    };
  }
}
