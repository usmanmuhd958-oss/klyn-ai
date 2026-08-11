export class SelfHealingRecoveryDecisionEngine {
  recover(issue:any){
    return {
      issue,
      recovery:"planned"
    };
  }
}
