export class MemoryStore {

  private memories:any[]=[];


  save(memory:any){

    this.memories.push(memory);

    return memory;

  }


  all(){

    return this.memories;

  }

}
