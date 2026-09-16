export class IntelligenceDiagnostics {
  diagnose(metrics:any){
    return {
      metrics,
      health:"evaluated"
    };
  }
}
