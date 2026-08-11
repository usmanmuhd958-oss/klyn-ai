export class KnowledgeGraphInferenceController {
  infer(context:any){
    return {
      inference:"completed",
      context
    };
  }
}
