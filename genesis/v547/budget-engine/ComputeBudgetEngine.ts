export class ComputeBudgetEngine {
  allocate(agent:string, budget:number){
    return {
      agent,
      budget
    };
  }
}
