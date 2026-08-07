export class StrategyMemory {
  remember(strategy:any){
    return {
      strategy,
      stored:true
    };
  }
}
