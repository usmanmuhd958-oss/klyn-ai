export class UnifiedState {

  update(state:string){
    return {
      state,
      synchronized:true
    };
  }

}
