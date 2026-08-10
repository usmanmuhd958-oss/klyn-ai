export class RAGController {

 retrieve(query:string){

  return {
   query,
   context:"retrieved"
  };

 }

}
