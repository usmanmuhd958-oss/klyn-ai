import { KnowledgeNode } from "./KnowledgeNode.js";
import { KnowledgeEdge } from "./KnowledgeEdge.js";


export class KnowledgeGraph {


 nodes:KnowledgeNode[]=[];

 edges:KnowledgeEdge[]=[];


 addNode(node:KnowledgeNode){

  this.nodes.push(node);

 }


 addEdge(edge:KnowledgeEdge){

  this.edges.push(edge);

 }


 query(id:string){

  return {

   node:this.nodes.find(
    n=>n.id===id
   ),

   edges:this.edges.filter(
    e=>e.from===id
   )

  };

 }


}
