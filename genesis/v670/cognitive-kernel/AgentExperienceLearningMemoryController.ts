export class AgentExperienceLearningMemoryController {
  learn(event:any){
    return {
      event,
      learned:true
    };
  }
}
