export class KnowledgeInferenceModule {
  infer(data:string){
    return {
      status:"inferred",
      data
    };
  }
}
