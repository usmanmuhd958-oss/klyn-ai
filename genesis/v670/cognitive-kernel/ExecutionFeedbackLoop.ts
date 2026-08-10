export class ExecutionFeedbackLoop {
  process(event:string){
    return {
      status:"processed",
      event
    };
  }
}
