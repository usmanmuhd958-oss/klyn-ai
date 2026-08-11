export class AdaptiveMemoryRetrievalController {
  retrieve(context:any){
    return {
      context,
      retrieval:"optimized"
    };
  }
}
