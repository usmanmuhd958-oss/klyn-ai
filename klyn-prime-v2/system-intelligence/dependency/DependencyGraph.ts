export interface DependencyNode {

 name:string;

 dependsOn:string[];

}


export class DependencyGraph {


 private nodes:DependencyNode[]=[];


 add(node:DependencyNode){

   this.nodes.push(node);

 }


 getDependencies(name:string){

   return this.nodes.find(
     n=>n.name===name
   );

 }


 analyze(){

   return {

     totalNodes:this.nodes.length,

     graph:this.nodes

   };

 }


}
