export class DistributedMemoryCore {

 memories:any[]=[];

 store(data:any){

  this.memories.push(data);

 }

 retrieve(){

  return this.memories;

 }

}
