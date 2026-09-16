export class DistributedAgentWorkloadCoordinator {
  distribute(tasks:any[]){
    return {
      tasks,
      balanced:true
    };
  }
}
