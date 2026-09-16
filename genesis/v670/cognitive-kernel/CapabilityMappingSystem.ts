export class CapabilityMappingSystem {
  map(capability:string){
    return {
      status:"mapped",
      capability
    };
  }
}
