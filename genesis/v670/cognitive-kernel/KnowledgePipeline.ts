export class KnowledgePipeline {

 ingest(data:string){

  return {
   input:data,
   pipeline:"processed"
  };

 }

}
