export class DistributedMemoryCore {
  store(memory:any){
    return {
      memory,
      distributed:true
    };
  }
}
