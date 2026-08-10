export class AutonomousMultiAgentIntelligenceSupervisor {

  agents:any[] = [];

  register(agent:string){
    this.agents.push(agent);
    return this.agents;
  }

}
