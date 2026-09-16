export class TaskExecutionGraph {

  execute(tasks:string[]){
    return {
      tasks,
      status:"executed"
    };
  }

}
