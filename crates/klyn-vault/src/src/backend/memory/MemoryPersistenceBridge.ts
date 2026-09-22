import { PersistenceEngine } from "../database/PersistenceEngine.js";

export class MemoryPersistenceBridge {

 constructor(
   private persistence=new PersistenceEngine()
 ){}

 async persist(id:string,data:unknown){

   return this.persistence.write(id,data);

 }

 async restore(id:string){

   return this.persistence.read(id);

 }

}
