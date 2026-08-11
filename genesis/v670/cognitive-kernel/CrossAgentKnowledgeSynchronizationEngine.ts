export class CrossAgentKnowledgeSynchronizationEngine {
  sync(agents:any[]){
    return {
      agents,
      sharedKnowledge:true
    };
  }
}
