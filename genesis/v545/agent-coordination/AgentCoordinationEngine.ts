export class AgentCoordinationEngine {
  coordinate(agents:string[]){
    return {
      agents,
      coordinated:true
    };
  }
}
