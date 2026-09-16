export class DigitalEnvironmentPredictor {

  predict(environment:any){
    return {
      status:"environment_prediction_active",
      environment
    };
  }

}
