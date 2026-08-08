export class StrategyCore {
  generate(objective:any){
    return {
      objective,
      strategy:"generated"
    };
  }
}
