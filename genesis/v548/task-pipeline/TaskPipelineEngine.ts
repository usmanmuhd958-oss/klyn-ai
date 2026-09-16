export class TaskPipelineEngine {
  add(task:string){
    return {
      task,
      queued:true
    };
  }
}
