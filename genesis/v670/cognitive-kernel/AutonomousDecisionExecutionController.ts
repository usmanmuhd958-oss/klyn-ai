export class AutonomousDecisionExecutionController {
  execute(decision:any){
    return {
      decision,
      execution:"triggered"
    };
  }
}
