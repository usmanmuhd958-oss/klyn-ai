import { MemorySynapse }
from "./MemorySynapse";

import { CognitiveController }
from "./CognitiveController";


export class CognitiveMemoryController {

 private memory =
   new MemorySynapse();

 private brain =
   new CognitiveController();


 execute(task:any){

   const history =
     this.memory.recall(task.goal);


   const result =
     this.brain.execute(task);


   this.memory.remember({
     task,
     result
   });


   return {
     history,
     result,
     memory:
     this.memory.stats()
   };

 }

}
