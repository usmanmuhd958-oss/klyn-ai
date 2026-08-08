export class TaskScheduler {

  private queue:any[] = [];

  add(task:any){
    this.queue.push(task);
  }

  next(){
    return this.queue.shift();
  }

  size(){
    return this.queue.length;
  }

}
