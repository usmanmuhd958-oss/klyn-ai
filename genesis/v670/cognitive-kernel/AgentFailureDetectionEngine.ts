export class AgentFailureDetectionEngine {
  detect(state:any){
    return {
      healthy:true,
      state
    };
  }
}
