export class FabricMemory {
  store(data:any){
    return {
      data,
      stored:true
    };
  }
}
