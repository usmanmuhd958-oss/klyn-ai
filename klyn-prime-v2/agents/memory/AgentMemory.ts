export interface MemoryEntry {

  id:string;

  type:string;

  content:unknown;

  timestamp:number;

}


export class AgentMemory {


  private memories: MemoryEntry[] = [];


  store(entry:MemoryEntry){

    this.memories.push(entry);

  }


  recall(){

    return this.memories;

  }


}
