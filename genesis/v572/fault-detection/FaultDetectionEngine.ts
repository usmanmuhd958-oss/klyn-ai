export class FaultDetectionEngine {
  detect(metrics:any){
    return {
      metrics,
      faults:[]
    };
  }
}
