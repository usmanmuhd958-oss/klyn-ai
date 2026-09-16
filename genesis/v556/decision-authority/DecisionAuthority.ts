export class DecisionAuthority {
  decide(action:string){
    return {
      action,
      authority:"granted"
    };
  }
}
