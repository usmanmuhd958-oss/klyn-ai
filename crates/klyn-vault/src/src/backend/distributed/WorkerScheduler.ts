export class WorkerScheduler {


 schedule(task:any,nodes:any[]){

  return {

   task,

   node:nodes[0] || null

  };


 }


}
