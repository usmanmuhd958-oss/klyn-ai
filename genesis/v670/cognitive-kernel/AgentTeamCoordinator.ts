export class AgentTeamCoordinator {
  coordinate(team:string[]){
    return {
      status:"coordinated",
      team
    };
  }
}
