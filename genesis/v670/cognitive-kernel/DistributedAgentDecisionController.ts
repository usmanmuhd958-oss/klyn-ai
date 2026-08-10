export class DistributedAgentDecisionController {

  decide(inputs:any){
    return {
      inputs,
      decisionGenerated:true
    };
  }

}
