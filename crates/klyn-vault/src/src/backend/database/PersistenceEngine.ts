export class PersistenceEngine {

 private storage = new Map<string,unknown>();

 async write(key:string,value:unknown){

   this.storage.set(key,value);

   return {
    saved:true,
    key
   };

 }


 async read(key:string){

   return this.storage.get(key);

 }

}
