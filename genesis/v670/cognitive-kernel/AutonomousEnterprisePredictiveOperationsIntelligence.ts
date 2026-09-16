export class AutonomousEnterprisePredictiveOperationsIntelligence {

  status:string="initialized";

  predict(){
    this.status="predicting";
    return this.status;
  }

}
