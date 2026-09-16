export class CollaborationMemory {
  remember(event:string){
    return {
      event,
      stored:true
    };
  }
}
