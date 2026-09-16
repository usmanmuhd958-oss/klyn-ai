export class LawMemory {
  store(rule:string){
    return {
      rule,
      stored:true
    };
  }
}
