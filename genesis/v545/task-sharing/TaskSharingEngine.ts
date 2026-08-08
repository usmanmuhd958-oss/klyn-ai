export class TaskSharingEngine {
  assign(task:string){
    return {
      task,
      status:"assigned"
    };
  }
}
