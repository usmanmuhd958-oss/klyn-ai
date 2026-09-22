export class DistributedExecutor {


 execute(task:any,node:any){

  return {

   executed:true,

   task,

   node

  };


 }


}
