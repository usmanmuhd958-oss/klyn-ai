export class AgentRoleManager {


  assign(agent:any, role:string){

    return {

      agent,

      role,

      assigned:true

    };

  }


}
