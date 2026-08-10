export class AutonomousAgentRuntimeMesh {

  agents:string[] = [];

  register(agent:string){
    this.agents.push(agent);
    return this.agents;
  }

}
