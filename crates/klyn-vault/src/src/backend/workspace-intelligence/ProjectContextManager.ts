export class ProjectContextManager {


  private projects = new Map<string, any>();


  register(id:string, data:any){

    this.projects.set(id,data);

  }


  get(id:string){

    return this.projects.get(id);

  }

}
