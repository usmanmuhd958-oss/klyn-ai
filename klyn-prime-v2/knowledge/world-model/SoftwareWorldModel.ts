import { KnowledgeGraph } from "../graph/KnowledgeGraph";


export class SoftwareWorldModel {


 private graph =
   new KnowledgeGraph();



 observe(component:string){


   this.graph.addNode({

     id:Date.now().toString(),

     type:"software-component",

     data:component

   });


 }



 getReality(){

   return this.graph.getNodes();

 }


}
