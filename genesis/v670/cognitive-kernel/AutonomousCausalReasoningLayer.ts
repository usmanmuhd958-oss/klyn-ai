export class AutonomousCausalReasoningLayer {
  reason(event:any){
    return {
      event,
      cause:"identified"
    };
  }
}
