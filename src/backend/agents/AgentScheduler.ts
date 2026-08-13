export class AgentScheduler {


 private queue:any[]=[];


 schedule(task:any){

  this.queue.push(task);

 }


 next(){

  return this.queue.shift();

 }


}
