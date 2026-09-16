export class ApexDecisionOrchestrator {

  decide(input:any){
    return {
      status:"apex_decision_generated",
      input
    };
  }

}
