export class ProductionLearningMemoryEngine {
  remember(event:any){
    return {
      event,
      memory:"stored"
    };
  }
}
