export class UnifiedAgentCapabilityRouter {
  route(capability:any){
    return {
      capability,
      route:"selected"
    };
  }
}
