export class EngineeringDecisionAuditMemory {
  record(decision:any){
    return {
      decision,
      memory:"stored"
    };
  }
}
