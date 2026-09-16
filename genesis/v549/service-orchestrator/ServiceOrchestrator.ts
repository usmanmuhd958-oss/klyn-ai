export class ServiceOrchestrator {
  orchestrate(task:string){
    return {
      task,
      running:true
    };
  }
}
