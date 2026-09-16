export class AutonomousStrategicPlanningLayer {
  plan(objective:any){
    return {
      objective,
      strategy:"generated"
    };
  }
}
