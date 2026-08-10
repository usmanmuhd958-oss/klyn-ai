export class EnterpriseCognitiveMemoryEngine {

  remember(event:string){
    return {
      event,
      learned:true
    };
  }

}
