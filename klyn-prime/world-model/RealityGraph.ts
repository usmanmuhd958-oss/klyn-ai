export interface RealityNode {

  id:string;

  type:string;

  name:string;

  metadata:any;

}


export interface RealityEdge {

  from:string;

  to:string;

  relationship:string;

}


export class RealityGraph {


 private nodes:RealityNode[] = [];

 private edges:RealityEdge[] = [];


 addNode(node:RealityNode){

   this.nodes.push(node);

 }


 connect(edge:RealityEdge){

   this.edges.push(edge);

 }


 getNodes(){

   return this.nodes;

 }


 getEdges(){

   return this.edges;

 }


}
