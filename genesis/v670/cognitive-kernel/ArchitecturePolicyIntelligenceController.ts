export class ArchitecturePolicyIntelligenceController {
  evaluate(policy:any){
    return {
      policy,
      status:"validated"
    };
  }
}
