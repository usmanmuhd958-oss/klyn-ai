export class MemoryReasoningExecutionEngine {
  reason(context:any){
    return {
      reasoning:"executed",
      context
    };
  }
}
