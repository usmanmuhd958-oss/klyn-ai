export class MemoryRetrievalEngine {


 retrieve(
  memories:any[],
  query:string
 ){

  return memories.filter(
   item =>
   JSON.stringify(item)
   .toLowerCase()
   .includes(
    query.toLowerCase()
   )
  );


 }


}
