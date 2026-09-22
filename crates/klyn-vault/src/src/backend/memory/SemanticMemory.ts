export interface KnowledgeRecord {

 id:string;

 concept:string;

 value:any;

}


export class SemanticMemory {


 private knowledge:KnowledgeRecord[]=[];


 store(record:KnowledgeRecord){

  this.knowledge.push(record);

 }


 search(query:string){

  return this.knowledge.filter(
   item =>
   item.concept
   .toLowerCase()
   .includes(
    query.toLowerCase()
   )
  );

 }


}
