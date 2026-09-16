export class SelfRegulation {
  regulate(state:string){
    return {
      state,
      balanced:true
    };
  }
}
