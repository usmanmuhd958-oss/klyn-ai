export class RuntimeScheduler {

  schedule(task:string){
    return {
      task,
      status:"scheduled"
    };
  }

}
