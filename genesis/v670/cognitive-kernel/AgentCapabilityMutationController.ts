export class AgentCapabilityMutationController {
  improve(capability:string){
    return {
      capability,
      status:"optimized"
    };
  }
}
