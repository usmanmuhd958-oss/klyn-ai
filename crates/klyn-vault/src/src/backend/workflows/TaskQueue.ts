export class TaskQueue {

 private queue:any[]=[];


 push(task:any){

  this.queue.push(task);

 }


 pop(){

  return this.queue.shift();

 }


 size(){

  return this.queue.length;

 }

}
