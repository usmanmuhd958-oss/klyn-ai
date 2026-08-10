export class AutonomousCapabilityDiscovery {
  discover(target:string){
    return {
      status:"discovered",
      target
    };
  }
}
