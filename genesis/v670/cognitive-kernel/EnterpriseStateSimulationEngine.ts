export class EnterpriseStateSimulationEngine {

  simulate(state:any){
    return {
      status:"state_simulation_active",
      state
    };
  }

}
