export class ResearchOutcomeEvaluationController {
  evaluate(result:any){
    return {
      result,
      evaluation:"completed"
    };
  }
}
