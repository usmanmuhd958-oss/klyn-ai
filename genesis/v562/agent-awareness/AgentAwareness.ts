export class AgentAwareness {
  observe(agent:string){
    return {
      agent,
      awareness:"connected"
    };
  }
}
