export class ContextAwarenessLayer {
  analyze(input:string){
    return {
      status:"context analyzed",
      input
    };
  }
}
