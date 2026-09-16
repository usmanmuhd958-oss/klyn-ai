export class DecisionOutcomeAnalysisController {
  analyze(result:any){
    return {
      result,
      analysis:"completed"
    };
  }
}
