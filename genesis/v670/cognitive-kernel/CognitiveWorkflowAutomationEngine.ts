export class CognitiveWorkflowAutomationEngine {
  automate(task:any){
    return {
      task,
      automated:true
    };
  }
}
