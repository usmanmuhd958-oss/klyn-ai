export class AutonomousSystemIntegrationCore {

  integrate(modules:any[]){
    return {
      status:"system_integrated",
      modules
    };
  }

}
