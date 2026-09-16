export class CapabilityMarketplace {

  register(capability:string){
    return {
      capability,
      registered:true
    };
  }

}
