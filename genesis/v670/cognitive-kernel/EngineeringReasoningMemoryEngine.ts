export class EngineeringReasoningMemoryEngine {
  remember(decision:any){
    return {
      decision,
      memory:"indexed"
    };
  }
}
