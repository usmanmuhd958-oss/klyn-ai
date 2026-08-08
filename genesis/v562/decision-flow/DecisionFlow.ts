export class DecisionFlow {
  decide(input:string){
    return {
      input,
      decision:"generated"
    };
  }
}
