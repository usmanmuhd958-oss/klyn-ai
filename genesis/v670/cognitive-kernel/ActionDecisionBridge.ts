export class ActionDecisionBridge {
  bridge(decision:string){
    return {
      status:"connected",
      decision
    };
  }
}
