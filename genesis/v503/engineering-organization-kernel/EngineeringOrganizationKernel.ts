export class EngineeringOrganizationKernel {

  private teams:any[] = [];

  registerTeam(team:any){
    this.teams.push(team);
  }

  getTeams(){
    return this.teams;
  }

  executeMission(mission:string){

    return {
      mission,
      teams:this.teams.map(t=>t.name),
      status:"assigned"
    };

  }

}
