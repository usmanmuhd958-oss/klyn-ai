export class AgentTaskDecompositionEngine {
  decompose(task:string){
    return {
      task,
      steps:[]
    };
  }
}
