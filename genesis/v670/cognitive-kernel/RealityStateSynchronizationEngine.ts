export class RealityStateSynchronizationEngine {

  synchronize(state:any){
    return {
      status:"reality_state_synchronized",
      state
    };
  }

}
