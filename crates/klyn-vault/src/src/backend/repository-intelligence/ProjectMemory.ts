export class ProjectMemory {


 private memory:any[]=[];


 remember(data:any){

  this.memory.push(data);

 }


 recall(){

  return this.memory;

 }


}
