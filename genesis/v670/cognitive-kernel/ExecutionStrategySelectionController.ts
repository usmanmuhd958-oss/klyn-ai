export class ExecutionStrategySelectionController {
  select(options:any){
    return {
      strategy:"optimized",
      options
    };
  }
}
