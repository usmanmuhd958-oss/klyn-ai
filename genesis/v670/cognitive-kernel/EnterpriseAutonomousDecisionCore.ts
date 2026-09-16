export class EnterpriseAutonomousDecisionCore {
  decide(context:any){
    return {
      context,
      decision:"autonomous"
    };
  }
}
