export class AgentDecisionRoutingController {
  route(decision:any){
    return {
      decision,
      route:"selected"
    };
  }
}
