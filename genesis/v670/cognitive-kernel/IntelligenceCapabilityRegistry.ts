export class IntelligenceCapabilityRegistry {

  register(capability:string){
    return {
      capability,
      registered:true
    };
  }

}
