export class EnterpriseKnowledgeRetrievalController {

  retrieve(query:any){
    return {
      status:"knowledge_retrieval_active",
      query
    };
  }

}
