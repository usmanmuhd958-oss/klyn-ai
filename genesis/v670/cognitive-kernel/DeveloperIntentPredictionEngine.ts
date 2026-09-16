export class DeveloperIntentPredictionEngine {
  predict(action:any){
    return {
      action,
      prediction:"generated"
    };
  }
}
