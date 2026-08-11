export class DynamicAgentCollaborationProtocol {
  collaborate(tasks:any[]){
    return {
      tasks,
      collaboration:"enabled"
    };
  }
}
