export class AutonomousEnterpriseIntelligenceRuntimeFabric {

  runtimeState:any = {};

  start(){
    this.runtimeState.status="active";
    return this.runtimeState;
  }

}
