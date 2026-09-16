export class SystemScenarioPredictionEngine {
  predict(scenario:any){
    return {
      scenario,
      prediction:"generated"
    };
  }
}
