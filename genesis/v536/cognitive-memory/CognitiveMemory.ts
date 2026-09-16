export class CognitiveMemory {

  memories:any[]=[];

  store(item:any){
    this.memories.push(item);
  }
}
