import { WorkerNode } from "./WorkerNode.js";


export class NodeRegistry {


 private nodes:WorkerNode[]=[];


 register(node:WorkerNode){

  this.nodes.push(node);

 }


 list(){

  return this.nodes;

 }


}
