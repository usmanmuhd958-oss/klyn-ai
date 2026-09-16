export class GovernanceCore {
  govern(system:string){
    return {
      system,
      governance:"active"
    };
  }
}
