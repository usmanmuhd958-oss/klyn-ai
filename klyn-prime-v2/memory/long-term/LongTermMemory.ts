import { MemoryItem } from "../working/WorkingMemory";


export class LongTermMemory {


 private storage:MemoryItem[]=[];


 store(item:MemoryItem){

   this.storage.push(item);

 }


 search(){

   return this.storage;

 }


}
