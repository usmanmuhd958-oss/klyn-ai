export class AgentExperienceFeedbackEngine {

  analyze(result:string){
    return {
      result,
      feedback:"processed"
    };
  }

}
