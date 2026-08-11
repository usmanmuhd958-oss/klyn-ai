export class CausalImpactAnalysisController {
  analyze(change:any){
    return {
      change,
      impact:"calculated"
    };
  }
}
