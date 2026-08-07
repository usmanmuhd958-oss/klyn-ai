export class ReasoningCore {
  analyze(input:string){
    return {
      reasoning: input,
      confidence: 0.5
    };
  }
}
