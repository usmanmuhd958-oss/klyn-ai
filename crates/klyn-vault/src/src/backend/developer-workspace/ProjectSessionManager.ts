export class ProjectSessionManager {


  private sessions:any[]=[];


  create(project:string){

    const session={

      id:crypto.randomUUID(),

      project,

      active:true

    };


    this.sessions.push(session);


    return session;

  }


  list(){

    return this.sessions;

  }


}
