export class AutonomousAgentCoordinator {
  coordinate(agents:string[]){
    return {
      status:"coordinated",
      agents
    };
  }
}
