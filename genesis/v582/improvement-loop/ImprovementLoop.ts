export class ImprovementLoop {
  improve(state:any){
    return {
      state,
      improved:true
    };
  }
}
