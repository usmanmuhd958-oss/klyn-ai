export class AutonomousEnterpriseObservabilityIntelligenceFabric {

  status:string="initialized";

  observe(){
    this.status="monitoring";
    return this.status;
  }

}
