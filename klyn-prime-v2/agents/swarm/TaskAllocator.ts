export class TaskAllocator {


 assign(
   task:string,
   agents:string[]
 ){

   return agents.map(agent => ({

     agent,

     task

   }));

 }


}
