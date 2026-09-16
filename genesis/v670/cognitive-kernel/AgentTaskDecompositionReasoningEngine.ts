export class AgentTaskDecompositionReasoningEngine {
  decompose(task:any){
    return {
      task,
      subtasks:[]
    };
  }
}
