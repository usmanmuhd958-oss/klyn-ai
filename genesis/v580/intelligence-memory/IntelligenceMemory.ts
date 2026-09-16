export class IntelligenceMemory {
  store(event:any){
    return {
      event,
      persistent:true
    };
  }
}
