export class IntelligentRecallEngine {
  recall(query:string){
    return {
      query,
      recalled:true
    };
  }
}
