export class AgentDelegationIntelligenceController {

  delegate(task:string){
    return {
      task,
      assigned:true
    };
  }

}
