export class DistributedEnterpriseKnowledgeCoordinator {
  synchronize(knowledge:any){
    return {
      knowledge,
      synchronized:true
    };
  }
}
