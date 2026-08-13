import { IntelligenceMesh } from "./IntelligenceMesh.js";
import { NodeCoordinator } from "./NodeCoordinator.js";


export class IntelligenceFabricController {


 mesh =
  new IntelligenceMesh();


 coordinator =
  new NodeCoordinator();


 initialize(nodes:any[]){

  nodes.forEach(node =>
   this.coordinator.register(node)
  );


  return this.mesh.connect(nodes);

 }


}
