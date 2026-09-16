export class AutonomousStrategicReasoningLayer {
  reason(objective:any){
    return {
      objective,
      strategy:"generated"
    };
  }
}
