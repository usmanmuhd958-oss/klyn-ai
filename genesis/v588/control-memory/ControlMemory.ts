export class ControlMemory {

 private history:any[]=[];


 remember(event:any){

   this.history.push(event);

 }


 recall(){

   return this.history;

 }

}
