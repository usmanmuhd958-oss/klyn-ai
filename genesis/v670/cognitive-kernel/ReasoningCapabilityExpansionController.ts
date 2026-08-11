export class ReasoningCapabilityExpansionController {
  expand(capability:any){
    return {
      capability,
      expanded:true
    };
  }
}
