export class AgentCapabilityRuntimeLoader {
  load(capability:string){
    return {
      capability,
      status:"loaded"
    };
  }
}
