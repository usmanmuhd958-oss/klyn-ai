export class GlobalReasoningEngine {
  reason(problem:string){
    return {
      problem,
      reasoning:"global",
      solutionReady:true
    };
  }
}
