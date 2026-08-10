export class WorkflowTaskPlanner {

  plan(tasks:string[]){
    return tasks.map(task=>({
      task,
      state:"planned"
    }));
  }

}
