export class AutonomousOperationalDecisionController {
  decide(signal:any){
    return {
      signal,
      action:"selected"
    };
  }
}
