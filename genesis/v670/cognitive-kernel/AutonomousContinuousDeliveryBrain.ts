export class AutonomousContinuousDeliveryBrain {
  decide(release:any){
    return {
      release,
      decision:"approved"
    };
  }
}
