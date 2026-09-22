import { ProjectMemory } from "./ProjectMemory.js";


export class RepositoryKnowledgeEngine {


 memory =
  new ProjectMemory();



 learn(data:any){

  this.memory.remember(data);


  return {

   learned:true

  };

 }


}
