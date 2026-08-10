export class PredictiveAnomalyDetectionController {

  analyze(signal:any){
    return {
      status:"anomaly_prediction_active",
      signal
    };
  }

}
