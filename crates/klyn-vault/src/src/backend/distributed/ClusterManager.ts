import { NodeRegistry } from "./NodeRegistry.js";
import { ClusterState } from "./ClusterState.js";


export class ClusterManager {


 registry =
  new NodeRegistry();


 state =
  new ClusterState();



 start(){

  this.state.update(
   "ONLINE"
  );


  return {

   status:this.state.get(),

   nodes:this.registry.list()

  };

 }


}
