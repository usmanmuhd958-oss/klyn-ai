export class AutonomousEnterpriseIntelligenceFederationLayer {

  status:string="initialized";

  federate(){
    this.status="federated";
    return this.status;
  }

}
