export class IntelligentMemoryRetrievalController {
  retrieve(query:any){
    return {
      query,
      retrieved:true
    };
  }
}
