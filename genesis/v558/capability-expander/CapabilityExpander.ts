export class CapabilityExpander {
  expand(capability:string){
    return {
      capability,
      expanded:true
    };
  }
}
