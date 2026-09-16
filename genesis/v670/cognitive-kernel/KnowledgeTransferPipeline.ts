export class KnowledgeTransferPipeline {
  transfer(source:string){
    return {
      status:"transferred",
      source
    };
  }
}
