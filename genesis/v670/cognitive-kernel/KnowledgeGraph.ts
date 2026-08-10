import {KnowledgeNode} from "./KnowledgeNode";
import {KnowledgeEdge} from "./KnowledgeEdge";

export class KnowledgeGraph {

 nodes:KnowledgeNode[]=[];
 edges:KnowledgeEdge[]=[];

 addNode(node:KnowledgeNode){
  this.nodes.push(node);
 }

 connect(edge:KnowledgeEdge){
  this.edges.push(edge);
 }

}
