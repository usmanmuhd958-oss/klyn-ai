export class CoordinationMemory {
  remember(event:any){
    return {
      event,
      stored:true
    };
  }
}
