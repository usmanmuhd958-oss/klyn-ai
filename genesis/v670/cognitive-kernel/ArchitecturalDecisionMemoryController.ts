export class ArchitecturalDecisionMemoryController {
  record(decision:any){
    return {
      decision,
      record:"saved"
    };
  }
}
