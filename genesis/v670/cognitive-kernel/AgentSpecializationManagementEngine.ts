export class AgentSpecializationManagementEngine {
  specialize(agent:any,skill:any){
    return {
      agent,
      skill,
      specialization:"assigned"
    };
  }
}
