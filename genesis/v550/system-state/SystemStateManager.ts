export class SystemStateManager {
  observe(state:string){
    return {
      state,
      monitored:true
    };
  }
}
