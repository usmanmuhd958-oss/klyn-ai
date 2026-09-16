export class CognitiveExecutionRouter {

  route(task:any){
    return {
      status:"execution_routed",
      task
    };
  }

}
