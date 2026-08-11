export class CognitiveMemoryGraphDatabase {

  private nodes = new Map();

  storeMemory(id:string,data:any){
    this.nodes.set(id,data);
  }

  retrieveMemory(id:string){
    return this.nodes.get(id);
  }

}
