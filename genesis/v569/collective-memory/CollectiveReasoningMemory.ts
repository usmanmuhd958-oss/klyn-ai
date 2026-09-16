export class CollectiveReasoningMemory {
  remember(reasoning:any){
    return {
      reasoning,
      stored:true
    };
  }
}
