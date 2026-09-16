export class AgentPolicyExecutionEngine {
  validate(policy:any){
    return {
      approved:true,
      policy
    };
  }
}
