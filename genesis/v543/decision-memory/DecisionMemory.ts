export class DecisionMemory {
  save(decision:string){
    return {
      decision,
      timestamp:Date.now()
    };
  }
}
