export class ArchitectureOutcomeEvaluationController {
  evaluate(outcome:any){
    return {
      outcome,
      evaluation:"completed"
    };
  }
}
