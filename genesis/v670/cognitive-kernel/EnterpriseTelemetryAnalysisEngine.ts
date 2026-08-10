export class EnterpriseTelemetryAnalysisEngine {

  analyze(metrics:any){
    return {
      status:"telemetry_analysis_active",
      metrics
    };
  }

}
