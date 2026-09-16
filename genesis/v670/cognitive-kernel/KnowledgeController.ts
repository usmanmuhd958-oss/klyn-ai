import {KnowledgeGraph} from "./KnowledgeGraph";

export class KnowledgeController {

 graph=new KnowledgeGraph();

 register(data:any){

  this.graph.addNode({
   id:Date.now().toString(),
   type:"memory",
   data
  });

 }

}
