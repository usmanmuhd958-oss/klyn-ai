export class MemoryGraphRelationshipEngine {

  connect(a:string,b:string){
    return {
      source:a,
      target:b
    };
  }

}
