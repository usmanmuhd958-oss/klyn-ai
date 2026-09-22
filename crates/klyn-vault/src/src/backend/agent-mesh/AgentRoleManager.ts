export class AgentRoleManager {


  roles = new Map<string,string>();


  assign(agent:string, role:string){

    this.roles.set(agent,role);

  }


  get(agent:string){

    return this.roles.get(agent);

  }


}
