export class AgentCoordinationSupervisor {

  coordinate(task:string){
    return {
      task,
      status:"coordinated"
    };
  }

}
