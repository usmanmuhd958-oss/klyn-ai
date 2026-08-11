export class AgentHistoricalDecisionMemoryEngine {
  retrieve(query:any){
    return {
      query,
      history:"loaded"
    };
  }
}
