import { VectorRetrievalEngine } from "./VectorRetrievalEngine.js";


export class RAGPipeline {


 retrieval =
  new VectorRetrievalEngine();


 execute(
  knowledge:any[],
  query:string
 ){

  return this.retrieval.search(
   knowledge,
   query
  );

 }


}
