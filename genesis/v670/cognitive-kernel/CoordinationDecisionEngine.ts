export class CoordinationDecisionEngine {

  decide(context:any){
    return {
      status:"coordination_decision_generated",
      context
    };
  }

}
