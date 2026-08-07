export class CognitionMemory {
  store(thought:any){
    return {
      thought,
      persistent:true
    };
  }
}
