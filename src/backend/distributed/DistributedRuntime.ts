import { ClusterManager } from "./ClusterManager.js";
import { ExecutionCoordinator } from "./ExecutionCoordinator.js";


export class DistributedRuntime {


 cluster =
  new ClusterManager();


 execution =
  new ExecutionCoordinator();



 boot(){

  return this.cluster.start();

 }


 run(task:any,nodes:any[]){

  return this.execution.coordinate(
   task,
   nodes
  );


 }


}
