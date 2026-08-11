export class AgentKnowledgeRetentionController {
  retain(knowledge:any){
    return {
      knowledge,
      retention:"active"
    };
  }
}
