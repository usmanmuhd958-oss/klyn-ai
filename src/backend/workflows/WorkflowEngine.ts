import { TaskQueue } from "./TaskQueue.js";
import { TaskExecutor } from "./TaskExecutor.js";


export class WorkflowEngine {


 queue =
  new TaskQueue();


 executor =
  new TaskExecutor();



 run(tasks:any[]){

  for(const task of tasks){

   this.queue.push(task);

  }


  const results=[];


  let task;


  while(task=this.queue.pop()){

   results.push(
    this.executor.execute(task)
   );

  }


  return results;

 }


}
