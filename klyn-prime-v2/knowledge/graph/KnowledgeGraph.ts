export interface KnowledgeNode {

 id:string;

 type:string;

 data:any;

}


export interface KnowledgeEdge {

 from:string;

 to:string;

 relation:string;

}


export class KnowledgeGraph {


 private nodes:KnowledgeNode[]=[];

 private edges:KnowledgeEdge[]=[];



 addNode(node:KnowledgeNode){

   this.nodes.push(node);

 }



 addRelation(edge:KnowledgeEdge){

   this.edges.push(edge);

 }



 getNodes(){

   return this.nodes;

 }



 getRelations(){

   return this.edges;

 }


}
