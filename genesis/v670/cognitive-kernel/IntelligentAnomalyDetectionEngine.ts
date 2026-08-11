export class IntelligentAnomalyDetectionEngine {
  detect(metric:any){
    return {
      metric,
      anomaly:false
    };
  }
}
