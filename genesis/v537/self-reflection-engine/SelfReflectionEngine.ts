export class SelfReflectionEngine {

  analyze(state:any){

    return {
      reflection:true,
      state,
      improvements:[]
    };
  }
}
