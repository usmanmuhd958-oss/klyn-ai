export class AutonomousEnterpriseIntelligenceMarketplaceLayer {

  status:string="initialized";

  publish(){
    this.status="available";
    return this.status;
  }

}
