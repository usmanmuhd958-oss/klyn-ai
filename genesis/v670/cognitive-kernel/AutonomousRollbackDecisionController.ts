export class AutonomousRollbackDecisionController {
  decide(signal:any){
    return {
      signal,
      rollback:false
    };
  }
}
