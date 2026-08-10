export class AgentCapabilityExpansionEngine {

  expand(capability:any){
    return {
      status:"capability_expanded",
      capability
    };
  }

}
