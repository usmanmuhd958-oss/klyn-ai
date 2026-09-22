export class KnowledgeGraphEngine {


 private nodes:any[]=[];


 add(node:any){

   this.nodes.push(node);

 }


 getNodes(){

   return this.nodes;

 }


}
