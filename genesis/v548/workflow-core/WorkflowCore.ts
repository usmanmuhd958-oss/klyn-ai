export class WorkflowCore {
  create(name:string){
    return {
      workflow:name,
      active:true
    };
  }
}
