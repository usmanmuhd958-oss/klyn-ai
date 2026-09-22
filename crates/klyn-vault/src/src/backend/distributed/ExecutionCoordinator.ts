import { WorkerScheduler } from "./WorkerScheduler.js";
import { DistributedExecutor } from "./DistributedExecutor.js";


export class ExecutionCoordinator {


 scheduler =
  new WorkerScheduler();


 executor =
  new DistributedExecutor();



 coordinate(task:any,nodes:any[]){

  const node =
   this.scheduler.schedule(
    task,
    nodes
   );


  return this.executor.execute(
   task,
   node.node
  );


 }


}
