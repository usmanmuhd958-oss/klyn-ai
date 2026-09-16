export class StrategyMemory {
  remember(strategy:string){
    return {
      strategy,
      stored:true
    };
  }
}
