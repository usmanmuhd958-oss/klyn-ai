export class RuntimeScheduler {

  schedule(task:string){
    return {
      task,
      scheduled:true
    };
  }

}
