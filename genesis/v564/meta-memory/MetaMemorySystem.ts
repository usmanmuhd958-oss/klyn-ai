export class MetaMemorySystem {
  store(event:any){
    return {
      event,
      memory:"meta"
    };
  }
}
