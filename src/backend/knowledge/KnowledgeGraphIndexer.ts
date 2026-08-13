export class KnowledgeGraphIndexer {


 index(items:any[]){

  return items.map(
   (item,index)=>({

    id:String(index),

    content:item

   })
  );

 }


}
