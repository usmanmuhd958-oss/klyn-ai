export class MemoryCoordination {
  sync(memory:string){
    return {
      memory,
      synchronized:true
    };
  }
}
