export interface MemoryRecord {
 id:string;
 type:string;
 data:any;
 timestamp:number;
}


export class MemoryFabric {

 private records:MemoryRecord[]=[];


 store(record:MemoryRecord){

  this.records.push(record);

 }


 search(type:string){

  return this.records.filter(
   r=>r.type===type
  );

 }


}
