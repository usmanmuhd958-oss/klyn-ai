export class AgentExecutionBridge {

  async execute(agent:any){

    return {
      agent,
      status:"ready"
    };

  }

}
