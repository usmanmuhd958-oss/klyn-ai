export interface ExecutionTask {

 id:string;

 agent:string;

 payload:any;

}



export class TaskDispatcher {


 private queue:ExecutionTask[];



 constructor(){

  this.queue=[];

 }



 dispatch(
 task:ExecutionTask
 ){

  this.queue.push(task);


  return {

    accepted:true,

    taskId:task.id,

    agent:task.agent

  };

 }



 pending(){

  return this.queue;

 }



 executeNext(){

  const task =
  this.queue.shift();


  if(!task){

    return null;

  }



  return {

    executed:true,

    task

  };


 }


}
