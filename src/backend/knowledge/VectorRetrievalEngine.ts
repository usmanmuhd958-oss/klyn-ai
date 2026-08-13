export class VectorRetrievalEngine {


 search(
  vectors:any[],
  query:string
 ){

  return vectors.filter(
   v =>
   JSON.stringify(v)
   .includes(query)
  );

 }


}
