export class DistributedTaskEngine {

 distribute(task:string){

  return {
   task,
   status:"distributed"
  };

 }

}
