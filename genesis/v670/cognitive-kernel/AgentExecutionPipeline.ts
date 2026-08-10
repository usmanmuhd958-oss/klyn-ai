export class AgentExecutionPipeline {

  run(agent:string,input:any){
    return {
      agent,
      input,
      pipeline:"complete"
    };
  }

}
