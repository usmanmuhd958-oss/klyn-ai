export class CognitiveTelemetryIntelligenceEngine {
  collect(metrics:any){
    return {
      metrics,
      collected:true
    };
  }
}
