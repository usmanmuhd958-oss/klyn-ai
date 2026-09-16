export class BrainStateMemory {

 private memory:any[]=[];

 store(data:any){
  this.memory.push(data);
 }

 recall(){
  return this.memory;
 }

}
