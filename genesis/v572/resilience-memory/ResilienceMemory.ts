export class ResilienceMemory {
  remember(event:any){
    return {
      event,
      stored:true
    };
  }
}
