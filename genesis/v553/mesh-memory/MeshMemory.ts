export class MeshMemory {

  store(event:string){
    return {
      event,
      stored:true
    };
  }

}
