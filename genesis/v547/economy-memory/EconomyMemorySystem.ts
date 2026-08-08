export class EconomyMemorySystem {
  save(event:string){
    return {
      event,
      stored:true
    };
  }
}
