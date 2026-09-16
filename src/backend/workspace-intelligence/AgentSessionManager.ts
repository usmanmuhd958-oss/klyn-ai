export class AgentSessionManager {


  private sessions:any[]=[];


  create(agent:any){

    this.sessions.push(agent);

    return agent;

  }


  list(){

    return this.sessions;

  }

}
