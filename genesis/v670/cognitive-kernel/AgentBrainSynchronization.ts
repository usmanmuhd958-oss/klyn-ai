export class AgentBrainSynchronization {

  synchronize(states:any[]){
    return {
      status:"agent_brain_synchronized",
      states
    };
  }

}
