export class ArchitectureMemory {
  remember(change:string){
    return {
      change,
      stored:true
    };
  }
}
