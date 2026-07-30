export class ContextEngine {


 private memory:any[]=[];


 add(data:any){

   this.memory.push(data);

 }


 retrieve(){

   return this.memory;

 }


}
