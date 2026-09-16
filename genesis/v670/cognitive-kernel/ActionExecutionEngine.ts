export class ActionExecutionEngine {
  run(task:string){
    return {
      status:"running",
      task
    };
  }
}
