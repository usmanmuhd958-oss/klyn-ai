export class BudgetMemory {
  remember(cost:number){
    return {
      cost,
      stored:true
    };
  }
}
