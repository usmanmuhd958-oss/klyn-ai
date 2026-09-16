export class GlobalStateManager {
  sync(state:any){
    return {
      state,
      synchronized:true
    };
  }
}
