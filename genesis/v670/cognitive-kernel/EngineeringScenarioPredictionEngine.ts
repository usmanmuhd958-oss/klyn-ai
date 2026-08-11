export class EngineeringScenarioPredictionEngine {
  predict(scenario:any){
    return {
      scenario,
      prediction:"generated"
    };
  }
}
