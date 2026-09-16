export class MultiAgentNegotiationEngine {
  negotiate(agents:string[]){
    return {
      status:"negotiated",
      agents
    };
  }
}
