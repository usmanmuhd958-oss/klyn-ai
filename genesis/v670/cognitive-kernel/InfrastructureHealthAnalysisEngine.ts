export class InfrastructureHealthAnalysisEngine {
  analyze(metrics:any){
    return {
      metrics,
      health:"evaluated"
    };
  }
}
