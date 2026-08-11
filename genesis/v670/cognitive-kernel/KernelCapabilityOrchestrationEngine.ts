export class KernelCapabilityOrchestrationEngine {
  orchestrate(capabilities:any[]){
    return {
      capabilities,
      orchestration:"active"
    };
  }
}
