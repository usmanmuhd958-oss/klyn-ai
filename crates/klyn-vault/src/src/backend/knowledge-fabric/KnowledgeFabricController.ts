import {KnowledgeGraphEngine} from "./KnowledgeGraphEngine.js";
import {KnowledgeIndexer} from "./KnowledgeIndexer.js";
import {KnowledgeRetrievalEngine} from "./KnowledgeRetrievalEngine.js";
import {KnowledgeRelationshipManager} from "./KnowledgeRelationshipManager.js";


export class KnowledgeFabricController {


 graph=new KnowledgeGraphEngine();

 indexer=new KnowledgeIndexer();

 retrieval=new KnowledgeRetrievalEngine();

 relationships=new KnowledgeRelationshipManager();



 process(input:any){

   return {

     indexed:
       this.indexer.index(input),

     knowledge:
       this.graph.getNodes(),

     search:
       this.retrieval.search(input.query),

     status:"knowledge-ready"

   };


 }


}
