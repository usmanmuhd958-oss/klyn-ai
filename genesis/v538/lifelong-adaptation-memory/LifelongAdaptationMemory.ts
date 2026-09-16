export class LifelongAdaptationMemory {

  memories:any[]=[];

  store(data:any){
    this.memories.push(data);
  }

  recall(){
    return this.memories;
  }
}
