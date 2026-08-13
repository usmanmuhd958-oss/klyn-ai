export class AgentExperienceCollector {

  collect(agent:string, result:any){

    return {
      agent,
      result,
      timestamp:Date.now()
    };

  }

}
