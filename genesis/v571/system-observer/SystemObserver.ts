export class SystemObserver {
  observe(state:any){
    return {
      state,
      observation:"active"
    };
  }
}
