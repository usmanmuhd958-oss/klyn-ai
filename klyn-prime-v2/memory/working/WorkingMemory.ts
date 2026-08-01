export interface MemoryItem {

 id:string;

 content:unknown;

 timestamp:number;

}


export class WorkingMemory {

 private items:MemoryItem[] = [];


 add(item:MemoryItem){

   this.items.push(item);

 }


 getAll(){

   return this.items;

 }


 clear(){

   this.items=[];

 }

}
