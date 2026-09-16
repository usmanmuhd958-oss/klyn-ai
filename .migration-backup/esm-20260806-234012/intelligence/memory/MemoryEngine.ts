
export interface MemoryRecord {

 id:string;

 type:string;

 data:unknown;

 created:number;

}


export class MemoryEngine {

 private memory:MemoryRecord[]=[];


 store(record:MemoryRecord){

    this.memory.push(record);

 }


 search(type:string){

    return this.memory.filter(
      m=>m.type===type
    );

 }

}

