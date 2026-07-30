import { NexusBus } from "../communication/NexusBus";


export class NexusOrchestrator {


 constructor(
  private bus:NexusBus
 ){}



 initialize(){

  this.bus.subscribe(
   "task.execute",
   (task)=>{

    console.log(
     "[ORCHESTRATOR]",
     task
    );

   }
  );


 }



 dispatch(
  task:any
 ){

  this.bus.publish(
   "task.execute",
   task
  );

 }


}
