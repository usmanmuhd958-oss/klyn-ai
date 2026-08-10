export class PlanningStrategyResolver {
  resolve(strategy:string){
    return {
      status:"resolved",
      strategy
    };
  }
}
