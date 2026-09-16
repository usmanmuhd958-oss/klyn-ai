export class SystemStateSimulationEngine {
  simulate(state:any){
    return {
      state,
      prediction:"generated"
    };
  }
}
