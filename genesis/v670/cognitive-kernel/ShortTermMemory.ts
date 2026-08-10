export class ShortTermMemory {

 store(data:any){
   return {
    type:"short-term",
    data
   };
 }

}
