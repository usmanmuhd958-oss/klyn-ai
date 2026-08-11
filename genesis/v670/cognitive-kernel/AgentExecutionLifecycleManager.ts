export class AgentExecutionLifecycleManager {
  manage(state:any){
    return {
      state,
      lifecycle:"managed"
    };
  }
}
