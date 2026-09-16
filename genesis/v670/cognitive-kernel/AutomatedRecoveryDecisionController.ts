export class AutomatedRecoveryDecisionController {
  recover(issue:any){
    return {
      issue,
      recovery:"planned"
    };
  }
}
