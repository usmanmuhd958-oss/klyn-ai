export class ContinuousCapabilityEvolutionController {
  improve(capability:any){
    return {
      capability,
      evolution:"progressing"
    };
  }
}
