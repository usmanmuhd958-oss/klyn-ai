import { RealityGraph } from "./RealityGraph";
import { DependencyMap } from "./DependencyMap";


export class WorldModel {


graph = new RealityGraph();

dependencies = new DependencyMap();


understand(){

 return {

   nodes:this.graph.getNodes(),

   edges:this.graph.getEdges()

 };

}


}
