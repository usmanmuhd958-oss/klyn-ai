export interface MemoryItem{
 id:string;
 content:string;
}


export class MemoryRepository{

 private store:MemoryItem[]=[];


 save(item:MemoryItem){

   this.store.push(item);

   return item;

 }


 all(){

   return this.store;

 }

}
