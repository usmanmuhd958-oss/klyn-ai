export class SwarmCoordinator {
  coordinate(agents:string[]){
    return {
      status:"coordinated",
      agents
    };
  }
}
