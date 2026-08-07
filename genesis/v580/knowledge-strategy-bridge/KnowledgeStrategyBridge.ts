export class KnowledgeStrategyBridge {
  connect(knowledge:any,strategy:any){
    return {
      knowledge,
      strategy,
      connected:true
    };
  }
}
