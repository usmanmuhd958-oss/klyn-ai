export class DecisionAccountability {
  track(decision:any){
    return {
      decision,
      accountable:true
    };
  }
}
